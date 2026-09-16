#!/usr/bin/env node
/**
 * browser-extract.mjs — headless Playwright reader for the scan / JD-extraction
 * path (the opt-in alternative to the browser MCP; see #1449).
 *
 * The token cost of the MCP path is `browser_snapshot` streaming a page's whole
 * accessibility tree back to the model on every navigate. This helper renders
 * the same page headlessly and returns COMPACT JSON — just the fields the agent
 * needs — so the model processes a small result instead of a full snapshot.
 *
 * STRICTLY READ-ONLY: it navigates and reads the DOM. No clicks, typing, or form
 * fills — that boundary is exactly what keeps this separate from `apply`.
 *
 * Usage:
 *   node browser-extract.mjs <url> [--mode jd|listing] [--max N] [--max-chars N] [--timeout MS]
 *
 * `--max-chars` overrides the jd-mode text cap (default 12000) — raise it when a
 * long JD would otherwise be truncated at the tail, at the cost of more tokens.
 *
 * Modes:
 *   jd (default) — one posting page → { url, title, text }. `text` is the main
 *                  visible text, whitespace-collapsed and length-capped. For the
 *                  pipeline / oferta / auto-pipeline JD-extraction step.
 *   listing      — a careers/board page → { url, jobs: [{ title, url }] }. Visible
 *                  anchors that look like individual postings, deduped. For scan
 *                  Level 1 (reading a company's open roles).
 *
 * Output: compact JSON to stdout. Exit 0 on success; exit 1 on a hard error,
 * printing `{ "error": "...", "code": "..." }` (so a caller/mode can fall back
 * to the MCP path silently). Reuses liveness-browser.mjs's SSRF host guard and
 * realistic-UA context so it isn't instantly bot-walled.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import yaml from 'js-yaml';
import { LIVENESS_CONTEXT_OPTIONS, rejectPrivateOrInvalid } from './liveness-browser.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));

const DEFAULT_TIMEOUT_MS = 15_000;
const HYDRATION_WAIT_MS = 2_000;
// Lazy-loaded listing boards (see the scroll loop in main()).
const LISTING_SCROLL_PASSES = 5;
const LISTING_SCROLL_WAIT_MS = 1_200;
const LISTING_NETWORK_IDLE_MS = 8_000;
// "Load more" pagination (see expandListing()).
//
// APPEND-style controls only. A numbered pager's "Next" REPLACES the visible
// list instead of growing it, so clicking it would leave the final readDom
// holding only the last page — fewer jobs than not clicking at all. Collecting
// across numbered pages needs accumulation this extractor doesn't do, so those
// boards are left at their first page on purpose.
const LISTING_EXPAND_CLICKS = 10;
const LISTING_EXPAND_RE = /^(load|show|view|see)\s+(more|all)\b|^more\s+(jobs|roles|results|vacancies)\b/i;
const JD_TEXT_CAP = 12_000;     // plenty for a JD; a fraction of a full snapshot
const DEFAULT_LISTING_MAX = 200;

// Anchor labels that are navigation chrome, not job postings. Kept small and
// lowercase; matched against the trimmed label.
const NAV_LABEL_STOPWORDS = new Set([
  'home', 'about', 'about us', 'contact', 'contact us', 'login', 'log in', 'sign in',
  'sign up', 'register', 'privacy', 'privacy policy', 'terms', 'cookies', 'cookie policy',
  'careers', 'jobs', 'search', 'menu', 'back', 'next', 'previous', 'apply', 'apply now',
  'learn more', 'read more', 'faq', 'blog', 'news', 'help', 'support', 'english',
]);

/**
 * Resolve the configured scan extractor: `cli` (this helper) or `mcp` (default).
 * Reads `scan.extractor` from config/profile.yml; anything unrecognized — or a
 * missing/unreadable file — yields `mcp` so behavior never breaks. Exported so
 * doctor.mjs reports the same value.
 * @param {string} [profilePath]
 * @returns {'cli'|'mcp'}
 */
export function resolveExtractorMode(profilePath = join(CAREER_OPS, 'config/profile.yml')) {
  try {
    if (!existsSync(profilePath)) return 'mcp';
    const raw = yaml.load(readFileSync(profilePath, 'utf-8')) || {};
    const v = raw?.scan?.extractor;
    return v === 'cli' ? 'cli' : 'mcp';
  } catch {
    return 'mcp';
  }
}

// Collapse runs of whitespace and cap length so the JD text stays compact.
export function compactText(s, cap = JD_TEXT_CAP) {
  const text = String(s ?? '').replace(/[ \t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

/**
 * Shape a JD-mode result from the raw DOM read. Pure — exported for tests.
 * @param {{ title?: string, text?: string }} raw
 * @param {string} finalUrl
 */
export function normalizeJd(raw, finalUrl, textCap = JD_TEXT_CAP) {
  return {
    url: finalUrl,
    title: compactText(raw?.title || '', 300),
    text: compactText(raw?.text || '', textCap),
  };
}

/**
 * Shape a listing-mode result: keep visible anchors that look like individual
 * job postings, deduped by resolved URL, capped at `max`. Pure — exported for
 * tests. Anchors are dropped when the label is empty/too short or a nav
 * stopword, or the href isn't a resolvable http(s) URL.
 * @param {Array<{ href?: string, label?: string }>} anchors
 * @param {string} finalUrl - the page URL, used as the base to resolve relatives
 * @param {number} [max]
 */
/** Paths that are recognisably a job posting, used to keep a link that would
 *  otherwise be dropped as off-site. */
const JOB_PATH_RE = /\/(jobs?|vacanc(y|ies)|positions?|opportunit(y|ies)|careers?)\//i;

/** Second-level labels that are part of a public suffix rather than a real
 *  domain, so `x.co.uk` is compared as `x.co.uk` and not as `co.uk`. */
const PUBLIC_SLDS = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'sch', 'me', 'ltd', 'plc']);

/**
 * Registrable domain, approximately — enough to tell "another part of this
 * employer's board" from "somewhere else entirely" without shipping a full
 * public-suffix list.
 */
function siteOf(hostname) {
  const parts = String(hostname).toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const tail2 = parts.slice(-2);
  // e.g. ["co","uk"] → take one more label so we compare x.co.uk, not co.uk.
  if (PUBLIC_SLDS.has(tail2[0]) && tail2[1].length <= 3) return parts.slice(-3).join('.');
  return tail2.join('.');
}

export function normalizeListing(anchors, finalUrl, max = DEFAULT_LISTING_MAX) {
  const jobs = [];
  const seen = new Set();
  let listingHost = null;
  let listingSite = null;
  let listingSlug = '';
  try {
    const u = new URL(finalUrl);
    listingHost = u.hostname;
    listingSite = siteOf(u.hostname);
    listingSlug = u.pathname.split('/').filter(Boolean)[0] ?? '';
  } catch {
    /* caller passed something unparseable — fall back to no host filtering */
  }

  for (const a of Array.isArray(anchors) ? anchors : []) {
    const raw = String(a?.label ?? '');
    // A job card's anchor usually wraps the title in one block and the
    // metadata (contract type, office, department) in sibling blocks, so
    // innerText arrives as "Customer Care Advisor\nHYBRID — PERMANENT\n…".
    // Collapsing that whole string first produced titles like
    // "Customer Care Advisor HYBRID — PERMANENT PART-TIMECHILCOMPTON OFFICE,
    // SOMERSET" (verified against Lever's own API, which says just "Customer
    // Care Advisor"). Take the first non-empty LINE instead, and only fall
    // back to the collapsed whole when that line is too short to be a title.
    const firstLine = raw.split('\n').map((s) => s.trim()).find((s) => s.length >= 3) ?? '';
    const collapsed = raw.replace(/\s+/g, ' ').trim();
    const label = firstLine.length >= 3 ? firstLine.replace(/\s+/g, ' ') : collapsed;
    if (label.length < 3 || NAV_LABEL_STOPWORDS.has(label.toLowerCase())) continue;

    let url;
    try {
      url = new URL(String(a?.href ?? ''), finalUrl).href;
    } catch {
      continue;
    }
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) continue;
    // In-page anchors are never postings — they are the "skip to content"
    // links every accessible board opens with. Compare with the hash stripped
    // so a posting that merely carries a fragment still counts.
    parsed.hash = '';
    url = parsed.href;
    if (url.replace(/#.*$/, '') === String(finalUrl).replace(/#.*$/, '')) continue;
    // Off-site links are almost never postings — they are the company's own
    // marketing site, the ATS vendor's help pages, social icons. Dropping them
    // removed exactly the junk a real board produced ("Mulberry Home Page",
    // "Jobs powered by") without losing a single one of its 35 real postings.
    //
    // A link on another HOST is still kept in two cases:
    //  - it stays inside this employer's namespace on the same site.
    //    SmartRecruiters serves the board from careers.smartrecruiters.com but
    //    every posting from jobs.smartrecruiters.com/<Company>/<id>-<slug>, so
    //    a plain same-origin rule dropped all 169 of them. Requiring the
    //    leading path segment to match keeps those while still dropping
    //    www.lever.co/job-seeker-support/ from a jobs.lever.co/<company> board.
    //  - the path itself reads as a posting (JOB_PATH_RE), for boards that
    //    hand off to an entirely different vendor domain.
    if (listingHost && parsed.hostname !== listingHost) {
      const sameNamespace =
        siteOf(parsed.hostname) === listingSite &&
        listingSlug !== '' &&
        parsed.pathname.split('/').filter(Boolean)[0] === listingSlug;
      if (!sameNamespace && !JOB_PATH_RE.test(parsed.pathname)) continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    jobs.push({ title: label, url });
    if (jobs.length >= max) break;
  }
  return { url: finalUrl, jobs };
}

/**
 * Parse CLI args into { url, mode, max, timeout }. Index-based so a flag value
 * (e.g. the `listing` in `--mode listing`) is never mistaken for the URL, and an
 * explicit `0` is honored instead of being silently replaced by the default.
 * Exported for tests.
 * @param {string[]} argv - process.argv.slice(2)
 */
export function parseArgs(argv) {
  const FLAGS = new Set(['--mode', '--max', '--max-chars', '--timeout']);
  let url;
  let mode = 'jd';
  let max = DEFAULT_LISTING_MAX;
  let maxChars = JD_TEXT_CAP;
  let timeout = DEFAULT_TIMEOUT_MS;
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (FLAGS.has(tok)) {
      const val = argv[++i]; // consume the next token as this flag's value
      const n = Number(val);
      if (tok === '--mode' && val != null) mode = val;
      else if (tok === '--max' && Number.isInteger(n) && n >= 0) max = n;
      else if (tok === '--max-chars' && Number.isInteger(n) && n > 0) maxChars = n;
      else if (tok === '--timeout' && Number.isInteger(n) && n > 0) timeout = n;
    } else if (!tok.startsWith('--') && url === undefined) {
      url = tok;
    }
  }
  return { url, mode, max, maxChars, timeout };
}

/**
 * Click a board's "Load more" control until it runs out.
 *
 * Scrolling alone only helps boards that fetch on scroll; plenty of them hide
 * everything past the first batch behind an explicit button instead, and those
 * returned just that first batch. Bounded by LISTING_EXPAND_CLICKS, and it
 * stops as soon as the anchor count stops growing — unlike the scroll loop,
 * that check is safe here because a click that loaded nothing new means the
 * control is exhausted, not that the board is still warming up.
 *
 * Deliberately narrow: only controls whose own text matches
 * LISTING_EXPAND_RE. Never "Apply", "Submit" or anything that leaves the page.
 */
async function expandListing(page) {
  let previous = -1;
  for (let i = 0; i < LISTING_EXPAND_CLICKS; i++) {
    const count = await page.evaluate(() => document.querySelectorAll('a[href]').length);
    if (count <= previous) return;
    previous = count;

    const clicked = await page
      .evaluate((source) => {
        const re = new RegExp(source, 'i');
        const controls = document.querySelectorAll('button, [role="button"], a[href="#"]');
        for (const el of controls) {
          const label = (el.innerText || el.getAttribute('aria-label') || '').trim();
          if (!label || !re.test(label)) continue;
          if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
          const box = el.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) continue;
          el.click();
          return true;
        }
        return false;
      }, LISTING_EXPAND_RE.source)
      .catch(() => false);

    if (!clicked) return;
    await page.waitForTimeout(LISTING_SCROLL_WAIT_MS);
    await page.waitForLoadState('networkidle', { timeout: LISTING_NETWORK_IDLE_MS }).catch(() => {});
  }
}

// Read the raw DOM inside the page: title, main visible text, and visible
// anchors. Runs in the browser context; returns plain data only.
async function readDom(page) {
  return page.evaluate(() => {
    const title = (document.querySelector('h1')?.innerText || document.title || '').trim();

    // Main text: prefer <main>/[role=main]/<article>, else body; strip nav chrome.
    const root =
      document.querySelector('main, [role="main"], article') || document.body;
    let text = '';
    if (root) {
      const clone = root.cloneNode(true);
      clone.querySelectorAll('script, style, nav, header, footer, noscript').forEach((el) => el.remove());
      text = clone.innerText || '';
    }

    const anchors = Array.from(document.querySelectorAll('a[href]'))
      .filter((el) => {
        if (el.closest('nav, header, footer')) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return el.getClientRects().length > 0;
      })
      .map((el) => ({ href: el.getAttribute('href') || '', label: (el.innerText || '').trim() }));

    return { title, text, anchors };
  });
}

async function main() {
  const { url, mode, max, maxChars, timeout } = parseArgs(process.argv.slice(2));

  if (!url) {
    console.error(JSON.stringify({ error: 'usage: browser-extract.mjs <url> [--mode jd|listing] [--max N] [--max-chars N]', code: 'no_url' }));
    process.exit(1);
  }
  if (mode !== 'jd' && mode !== 'listing') {
    console.error(JSON.stringify({ error: `unknown mode "${mode}" (expected jd|listing)`, code: 'bad_mode' }));
    process.exit(1);
  }

  const guard = rejectPrivateOrInvalid(url);
  if (guard) {
    console.error(JSON.stringify({ error: guard.reason, code: guard.code }));
    process.exit(1);
  }

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error(JSON.stringify({ error: 'playwright not installed', code: 'no_playwright' }));
    process.exit(1);
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext(LIVENESS_CONTEXT_OPTIONS);
    // Block every request (main navigation, redirect hop, or subresource) to a
    // private/loopback/link-local or non-http(s) host. Guarding only the initial
    // URL isn't enough once we return page CONTENT: a server-side redirect could
    // otherwise steer the browser at internal infrastructure (SSRF).
    await context.route('**/*', (route) => {
      if (rejectPrivateOrInvalid(route.request().url())) return route.abort('blockedbyclient');
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForTimeout(HYDRATION_WAIT_MS); // let SPAs hydrate

    // Listing boards very often lazy-load their results: the first paint has
    // the chrome and nothing else. A flat hydration wait alone returned TWO
    // anchors from SmartRecruiters — both "skip to section" links — while the
    // board really had hundreds of postings. Scrolling triggers the fetch and
    // the same page then yields its real jobs.
    //
    // Bounded, and DELIBERATELY not short-circuited. Two attempts at "stop
    // early once the anchor count stops growing" both silently reintroduced
    // the bug: a board that hasn't returned its first batch yet is momentarily
    // flat, so the loop exited at ~2.4s and SmartRecruiters still yielded only
    // its two skip-links. The board needed the full ~6s. A fixed budget of
    // LISTING_SCROLL_PASSES × LISTING_SCROLL_WAIT_MS is predictable and
    // correct; the seconds saved on a short board were never worth re-breaking
    // this for. jd mode skips it entirely — a single posting page has nothing
    // to lazy-load.
    if (mode === 'listing') {
      for (let i = 0; i < LISTING_SCROLL_PASSES; i++) {
        await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
        await page.waitForTimeout(LISTING_SCROLL_WAIT_MS);
      }
      // Give any in-flight result fetch a chance to land. Non-fatal: a board
      // that keeps a socket open would otherwise hang here forever.
      await page.waitForLoadState('networkidle', { timeout: LISTING_NETWORK_IDLE_MS }).catch(() => {});
      await expandListing(page);
    }

    // Belt-and-suspenders: never emit content read from a private final URL.
    const finalUrl = page.url();
    const finalGuard = rejectPrivateOrInvalid(finalUrl);
    if (finalGuard) {
      console.error(JSON.stringify({ error: `blocked final URL: ${finalGuard.reason}`, code: finalGuard.code }));
      process.exitCode = 1;
      return;
    }
    const raw = await readDom(page);

    const result = mode === 'listing'
      ? normalizeListing(raw.anchors, finalUrl, max)
      : normalizeJd(raw, finalUrl, maxChars);
    process.stdout.write(JSON.stringify(result));
  } catch (err) {
    console.error(JSON.stringify({ error: `navigation error: ${String(err.message).split('\n')[0]}`, code: 'navigation_error' }));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// Only run main() when invoked directly, not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
