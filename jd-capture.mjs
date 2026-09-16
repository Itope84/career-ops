#!/usr/bin/env node
/**
 * jd-capture.mjs — captures the RENDERED job description for postings that
 * reach data/pipeline.md, and derives a compact, zero-token summary of it.
 *
 * WHY THIS EXISTS
 * ---------------
 * Two separate failures, one root cause: nothing downstream of the scanner
 * ever saw the job description.
 *
 *  1. Quick Triage judged on title/company/location alone, so a posting whose
 *     title looks perfect but whose body says "4+ years' experience" sailed
 *     through to a full (expensive) evaluation.
 *  2. Scoring fetched the URL itself with a plain HTTP tool — no browser. On a
 *     JS-rendered board that returns a shell plus whatever the page put in its
 *     JSON-LD. Real case: a Trend Micro Workday posting lists three locations
 *     (United Kingdom Off-Site, Ireland Off-Site, Spain Off-Site Barcelona),
 *     but only the UK one is in the structured data. The scorer read "UK
 *     only, remote-first", correctly applied the candidate's no-remote and
 *     UK-sponsorship rules, and returned 2.0/5 with "skip unless they confirm
 *     an Ireland-based arrangement" — for a role that is openly open to
 *     Ireland. Right reasoning, missing third of the facts.
 *
 * So: capture the text ONCE, at scan time, from a real browser, and let both
 * triage and scoring read it from disk instead of re-fetching badly.
 *
 * COST
 * ----
 * Effectively free. `scan --verify` already opens every new offer in Playwright
 * to check liveness and already extracts `document.body.innerText` — it just
 * threw it away. When that text is handed to us we store it as-is. Only the
 * gaps get their own render, and only for offers that actually reach the
 * inbox (a recent real scan: 2,237 postings seen, 39 appended).
 *
 * The summary is pure regex over that text — no model call, no tokens. That is
 * deliberate: triage exists to be the cheap pass, and paying per-job inference
 * to decide whether to pay per-job inference defeats it.
 *
 * STORAGE
 * -------
 * One file per posting at `data/jd-cache/<sha1(url)>.md`, with a small YAML
 * header. User layer (it is scraped content about the user's own pipeline),
 * gitignored alongside the rest of data/.
 *
 * CLI:
 *   node jd-capture.mjs --url <url>            # print the cached JD
 *   node jd-capture.mjs --summary <url>        # print the triage summary
 *   node jd-capture.mjs --stats                # cache size / coverage
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
export const JD_CACHE_DIR = join(ROOT, 'data', 'jd-cache');

/** Stable per-URL filename. sha1 is fine here — this is a cache key, not a
 *  security boundary — and keeps the name short enough to read in a listing. */
export function jdKey(url) {
  return createHash('sha1').update(String(url).trim()).digest('hex').slice(0, 16);
}

export function jdPathFor(url) {
  return join(JD_CACHE_DIR, `${jdKey(url)}.md`);
}

/** Cap what we keep. Job pages carry a lot of boilerplate (cookie banners,
 *  "about us", footers); past ~20k chars it is all chrome, and an unbounded
 *  cache file would work its way into a prompt someday. */
const MAX_TEXT = 20_000;

export function saveJd(url, text, { source = 'unknown', company = '', role = '' } = {}) {
  const clean = normalizeText(text);
  if (!clean || clean.length < 200) return null; // too short to be a real JD
  mkdirSync(JD_CACHE_DIR, { recursive: true });
  const path = jdPathFor(url);
  const header = [
    '---',
    `url: ${url}`,
    `company: ${JSON.stringify(company || '')}`,
    `role: ${JSON.stringify(role || '')}`,
    `source: ${source}`,
    `capturedAt: ${new Date().toISOString()}`,
    `chars: ${clean.length}`,
    '---',
    '',
  ].join('\n');
  writeFileSync(path, header + clean.slice(0, MAX_TEXT) + '\n');
  return path;
}

/** @returns {{url, source, capturedAt, text}|null} */
export function readJd(url) {
  const path = jdPathFor(url);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
  if (!m) return { url, source: 'unknown', capturedAt: null, text: raw };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2];
  }
  return { url, source: meta.source ?? 'unknown', capturedAt: meta.capturedAt ?? null, text: m[2] };
}

export function hasJd(url) {
  return existsSync(jdPathFor(url));
}

/** A LinkedIn job-view URL → its numeric posting id, else null. */
export function linkedInJobId(url) {
  const m = /^https:\/\/[a-z.]*linkedin\.com\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})(?:[/?#]|$)/i.exec(String(url ?? ''));
  return m ? m[1] : null;
}

/**
 * Fetch a LinkedIn posting's description via the public guest endpoint.
 *
 * Why this exists: the linkedin provider parses only the SEARCH CARDS (title,
 * company, location, url, postedAt) — it never had the description, so every
 * LinkedIn posting fell through to the Playwright render path below. That is
 * both slower and worse here: the public job page truncates the description
 * behind a "see more" control and shows guests a sign-in interstitial, so what
 * the renderer captured was partial at best.
 *
 * `jobs-guest/jobs/api/jobPosting/<id>` returns the full description as plain
 * HTML with no login (verified live: HTTP 200, ~67KB, description__text
 * present). One cheap GET, no browser.
 *
 * Volume note: this is called from scan.mjs's captureJdsFor(), which runs ONLY
 * over offers that already survived title/location filtering and dedup — a
 * handful per run, not the whole result page. Do not move it into the provider
 * and run it per search hit: the provider deliberately makes one request per
 * configured entry per scan, and LinkedIn rate-limits by IP.
 *
 * @param {string} url
 * @returns {Promise<string>} description text, or '' if unavailable
 */
export async function fetchLinkedInJd(url, { timeoutMs = 15_000, fetchImpl = fetch } = {}) {
  const id = linkedInJobId(url);
  if (!id) return '';
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'accept-language': 'en',
      },
      redirect: 'follow',
      signal: ac.signal,
    });
    if (!res.ok) return '';
    return htmlToText(descriptionSection(await res.text()));
  } catch {
    return ''; // never let a JD fetch fail a scan
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Narrow the page to just the description container.
 *
 * The full guest page carries a lot of chrome the JD must not inherit — "Join
 * or sign in to find your next job", applicant counts, the sign-in modal. Fed
 * to scoring, that text reads as part of the role. LinkedIn wraps the real
 * description in `.description__text`, so slice to it and fall back to the
 * whole document only if the class is ever renamed.
 */
function descriptionSection(html) {
  if (typeof html !== 'string') return '';
  const start = html.search(/<div[^>]*class="[^"]*description__text[^"]*"/i);
  if (start === -1) return html;
  // Cut at the "show more" control that closes the description block; that
  // marker sits immediately after the JD body on every posting checked.
  const rest = html.slice(start);
  // Cut BEFORE the opening tag, not inside it — slicing at the class name left
  // a dangling `<button class="` on the end of every capture.
  const end = rest.search(/<button[^>]*show-more-less-html__button|<\/section>/i);
  return end === -1 ? rest : rest.slice(0, end);
}

/** Minimal HTML → text: drop scripts/styles, turn block ends into newlines. */
function htmlToText(html) {
  if (typeof html !== 'string') return '';
  return decodeHtmlEntities(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr|section)>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, ' '),
  );
}

/**
 * The entities LinkedIn's markup actually emits. Currency symbols are NOT
 * optional here: a UK/EU posting writes its salary as `&pound;100,000` or
 * `&euro;`, and leaving those raw would hand the salary parser "pound;100,000".
 */
function decodeHtmlEntities(s) {
  return s
    .replace(
      /&(amp|lt|gt|quot|#39|apos|nbsp|hellip|mdash|ndash|rsquo|lsquo|ldquo|rdquo|pound|euro|yen|cent|copy|reg|trade|deg|frac12|middot|bull|times);/g,
      (_, e) => ({
        amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ',
        hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
        pound: '£', euro: '€', yen: '¥', cent: '¢', copy: '©', reg: '®', trade: '™',
        deg: '°', frac12: '½', middot: '·', bull: '•', times: '×',
      })[e] ?? _,
    )
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function normalizeText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Signal extraction ──────────────────────────────────────────────────────
// Everything below is deterministic. Each extractor returns null when it has
// no confident answer; a null is ALWAYS better than a guess, because these
// feed a discard decision.

/** "4+ years", "minimum of 3 years", "3-5 years' experience" → the LOWER bound
 *  (the actual bar). Returns the smallest bound found, since a JD often lists
 *  a strict "must have" and a looser "nice to have". */
export function extractYears(text) {
  const out = [];
  const re = /(\d{1,2})\s*(?:\+|\s*-\s*\d{1,2})?\s*(?:or more\s*)?years?(?:['’]|\s+of)?\s+(?:relevant\s+|proven\s+|demonstrable\s+|professional\s+|hands[- ]on\s+)?(?:work\s+)?experience/gi;
  let m;
  while ((m = re.exec(text))) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0 && n <= 20) out.push(n);
  }
  if (out.length === 0) return null;
  return Math.min(...out);
}

const LANGUAGES = [
  'French', 'German', 'Dutch', 'Spanish', 'Italian', 'Portuguese', 'Polish',
  'Swedish', 'Danish', 'Norwegian', 'Finnish', 'Czech', 'Hungarian', 'Romanian',
  'Greek', 'Turkish', 'Arabic', 'Mandarin', 'Cantonese', 'Japanese', 'Korean',
  'Russian', 'Hebrew', 'Hindi', 'Irish', 'Welsh',
];

/** Languages the posting REQUIRES, not merely mentions. "French speaking",
 *  "fluent in German", "native Dutch" count; "our French office" does not. */
export function extractLanguages(text) {
  const found = new Set();
  for (const lang of LANGUAGES) {
    const patterns = [
      new RegExp(`\\b${lang}[- ]speaking\\b`, 'i'),
      new RegExp(`\\b${lang}\\s+speaker\\b`, 'i'),
      new RegExp(`\\b(?:fluent|fluency|native|proficient|proficiency|bilingual)\\b[^.\\n]{0,40}\\b${lang}\\b`, 'i'),
      new RegExp(`\\b${lang}\\b[^.\\n]{0,30}\\b(?:fluency|fluent|native speaker|is (?:a )?must|required|essential)\\b`, 'i'),
    ];
    if (patterns.some((p) => p.test(text))) found.add(lang);
  }
  return found.size > 0 ? [...found] : null;
}

/** Every location the page lists. Workday-style multi-location postings are
 *  the reason this exists — the structured data carries one, the page many. */
export function extractLocations(text) {
  const out = [];
  // Workday renders a "locations" label followed by one per line.
  const block = text.match(/\blocations?\b\s*\n([\s\S]{0,300}?)(?:\n\s*\n|\btime type\b|\bposted on\b|\bjob requisition\b)/i);
  if (block) {
    for (const line of block[1].split('\n')) {
      const v = line.trim();
      if (v && v.length < 80 && !/^(time type|posted|apply)/i.test(v)) out.push(v);
    }
  }
  return out.length > 0 ? [...new Set(out)] : null;
}

/** Work model as the posting states it. */
export function extractWorkModel(text) {
  if (/\b(?:remote[- ]first|fully remote|100% remote|work from home|wfh)\b/i.test(text)) return 'remote';
  if (/\bhybrid\b/i.test(text)) return 'hybrid';
  if (/\b(?:on[- ]site|onsite|in[- ]office|office[- ]based)\b/i.test(text)) return 'onsite';
  if (/\bremote\b/i.test(text)) return 'remote-mentioned';
  return null;
}

/** An advertised band, if there is one. Deliberately conservative: an
 *  unadvertised salary must stay unadvertised (see profile.yml's
 *  `when_unadvertised` — never assume the band). */
export function extractSalary(text) {
  const m = text.match(/([€£$])\s?(\d{2,3})[,.]?(\d{3})?\s*(?:k\b)?\s*(?:-|–|to)\s*([€£$])?\s?(\d{2,3})[,.]?(\d{3})?\s*(?:k\b)?/i);
  if (!m) {
    const single = text.match(/([€£$])\s?(\d{2,3})[,.]?(\d{3})\b/);
    return single ? single[0].trim() : null;
  }
  return m[0].replace(/\s+/g, ' ').trim();
}

/**
 * A compact, prompt-ready digest of one posting. This is what triage sees in
 * place of the whole JD: the handful of facts that actually decide a discard,
 * plus a short requirements excerpt for anything the extractors missed.
 *
 * Kept short on purpose — a 25-job batch has to stay one cheap call.
 */
export function summarizeJd(text, { excerptChars = 320 } = {}) {
  if (!text || text.length < 100) return null;
  const bits = [];
  const years = extractYears(text);
  if (years != null) bits.push(`needs ${years}+ yrs exp`);
  const langs = extractLanguages(text);
  if (langs) bits.push(`requires ${langs.join('/')}`);
  const locs = extractLocations(text);
  if (locs) bits.push(`locations: ${locs.join(' / ')}`);
  const model = extractWorkModel(text);
  if (model) bits.push(model);
  const pay = extractSalary(text);
  if (pay) bits.push(`pay ${pay}`);

  const excerpt = requirementsExcerpt(text, excerptChars);
  const head = bits.length > 0 ? bits.join('; ') : null;
  if (!head && !excerpt) return null;
  return [head, excerpt].filter(Boolean).join(' — ');
}

/** The requirements section if the page has one, else the first substantive
 *  paragraph. Skips the cookie/nav boilerplate that opens most job pages. */
function requirementsExcerpt(text, max) {
  const m = text.match(
    /\b(?:requirements|qualifications|what (?:you['’]ll|we) (?:need|bring|are looking for)|must have|skills and experience|about you)\b[:\s]*\n?([\s\S]{80,1200})/i,
  );
  // The heading regex can match part-way through a heading line ("What Skills
  // and Experience | Should You Bring?"), which would open the excerpt on a
  // sentence fragment. If the remainder of that line is short and reads like
  // the tail of a heading, skip past it to the real body.
  const afterHeading = (chunk) => {
    const nl = chunk.indexOf('\n');
    if (nl > 0 && nl < 60 && /[?:]\s*$/.test(chunk.slice(0, nl).trim())) return chunk.slice(nl + 1);
    return chunk;
  };
  const chunk = m
    ? afterHeading(m[1])
    : (text
        .split('\n\n')
        .map((p) => p.trim())
        .find((p) => p.length > 120 && !/cookie|privacy|sign in|skip to main/i.test(p)) ?? '');
  return chunk ? chunk.replace(/\s+/g, ' ').slice(0, max).trim() : '';
}

// ── CLI ────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('jd-capture.mjs')) {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? null : argv[i + 1] ?? '';
  };
  if (argv.includes('--stats')) {
    const files = existsSync(JD_CACHE_DIR) ? readdirSync(JD_CACHE_DIR).filter((f) => f.endsWith('.md')) : [];
    console.log(JSON.stringify({ cached: files.length, dir: JD_CACHE_DIR }, null, 2));
  } else if (flag('--summary')) {
    const jd = readJd(flag('--summary'));
    console.log(jd ? (summarizeJd(jd.text) ?? '(no signals extracted)') : '(not cached)');
  } else if (flag('--url')) {
    const jd = readJd(flag('--url'));
    console.log(jd ? jd.text : '(not cached)');
  } else {
    console.error('usage: jd-capture.mjs [--stats | --url <url> | --summary <url>]');
    process.exit(1);
  }
}
