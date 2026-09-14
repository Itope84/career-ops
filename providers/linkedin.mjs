// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// LinkedIn provider — anonymous "guest" job-search HTML page, added
// 2026-09-13 as this project's highest-volume discovery source.
//
// WHY THIS EXISTS: LinkedIn is the largest job board for this profile by a
// wide margin, but this project's earlier attempt at LinkedIn coverage (a
// `search_queries` entry using a Google `site:linkedin.com/jobs` query) was
// worthless in practice — every single hit it produced in the 2026-09-11 scan
// run came back `skipped_expired` (see data/scan-history.tsv). That's because
// it went through GOOGLE's index of LinkedIn, which lags badly. This provider
// instead fetches LinkedIn's OWN public search-results page directly — no
// Google, no staleness.
//
// ✅ VERIFIED LIVE 2026-09-13 with a real, unauthenticated request run through
// this exact code path (Node's global fetch, same as ctx.fetchText below):
//   - https://www.linkedin.com/jobs/search?keywords=...&location=... returns
//     HTTP 200 fully server-rendered HTML — NO JavaScript execution needed,
//     NO login, NO cookies. One query ("Marketing Executive", "Galway,
//     Ireland") returned 60 real, fresh postings (posted dates ranging from
//     "today" to a few months old, not weeks-stale index snippets).
//   - Confirmed anonymous (not silently using a logged-in session): the page
//     shows "Sign in" links in its nav, not a logged-in profile.
//   - Each job card carries a STABLE numeric id in
//     `data-entity-urn="urn:li:jobPosting:<id>"` and the same id is embedded
//     in the card's own canonical link path — better than this project's
//     Careerjet provider, whose `url` is a single-use opaque token that
//     differs on every call for the same job (see careerjet.mjs's own header
//     for that problem). Stripping LinkedIn's tracking query params
//     (`position`/`pageNum`/`refId`/`trackingId`) off the href leaves a clean,
//     stable URL safe to use as scan.mjs's cross-run dedup key.
//
// ⚠️ THIS IS NOT AN OFFICIAL API — READ BEFORE ENABLING.
//   LinkedIn's official Jobs API is partner-only (incorporated companies,
//   currently not even accepting new partner applications — verified via
//   LinkedIn's own Microsoft Learn docs, 2026-09). There is no sanctioned way
//   for a personal project to query LinkedIn job data. This provider instead
//   scrapes the same public, logged-out HTML page LinkedIn serves to any
//   anonymous visitor (and to Google/Bing crawlers) — the same technique
//   behind most commercial "LinkedIn Jobs API" products. Two consequences:
//     1. This is against LinkedIn's User Agreement (automated access /
//        scraping is prohibited), even though no login is involved.
//     2. LinkedIn's abuse detection operates on the REQUESTING IP, not an
//        account — there is no login, so there is no personal account to
//        ban. The realistic risk is LinkedIn rate-limiting or CAPTCHA-walling
//        whatever IP this runs from if hit too often, not an account penalty.
//        Keep usage low-volume (this provider deliberately fetches ONE page
//        per configured entry per scan run — see "NO PAGINATION" below) and
//        run scans at the cadence this project already uses (every few days),
//        not continuously.
//   This provider ships disabled-by-default in portals.yml's job_boards
//   block; enabling it is an explicit, informed choice, not this file's.
//
// NO PAGINATION (confirmed live, not guessed): passing `&start=75` to try to
// reach a second page did NOT advance the result set — the page silently
// reset to `start=0`'s content instead. Rather than guess at an undocumented
// mechanism, this provider fetches ONLY the first page LinkedIn returns for a
// query (LinkedIn's own default batch size — 60 in the verified run above,
// may vary by market density). If a real pagination mechanism is confirmed
// live later, this is the place to add it.
//
// NO DATE/OTHER FILTER PARAMS: public write-ups of this endpoint document
// additional guest-search query params (e.g. a posted-within filter, remote
// toggle, experience level). None of those were tested against the live
// endpoint in this session, so none are wired in here — only `keywords` and
// `location`, both confirmed live above. Posting-age filtering already
// happens downstream via scan.mjs's `max_posting_age_days` against the
// `postedAt` this provider does expose (parsed from each card's real
// `datetime` attribute, not a relative "N days ago" string).
//
// Wire in via a `job_boards:` entry with `provider: linkedin`.

import { decodeEntities } from './_html-entities.mjs';
import { BROWSER_LIKE_USER_AGENT } from './_http.mjs';

const ALLOWED_HOST = 'www.linkedin.com';
const SEARCH_BASE = 'https://www.linkedin.com/jobs/search';

// LinkedIn's guest page 200s even for a challenge/interstitial response in
// some failure modes seen in the wild (not observed live in this session,
// but plausible given it's an unofficial surface) — a hard zero-cards result
// is treated as suspicious rather than "no jobs matched", so it surfaces as
// an error scan.mjs's run summary shows, instead of silently looking like an
// empty-but-healthy board.
const MARKER_RE = /data-entity-urn="urn:li:jobPosting:(\d+)"/g;

/** @param {string} url */
function assertLinkedInUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`linkedin: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`linkedin: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== ALLOWED_HOST) {
    throw new Error(`linkedin: untrusted hostname "${parsed.hostname}" — must be ${ALLOWED_HOST}`);
  }
  return url;
}

/**
 * Build the guest search URL. Exported for unit tests.
 *
 * @param {any} entry
 * @returns {string}
 */
export function buildLinkedInUrl(entry) {
  const keywords = (typeof entry?.keywords === 'string' && entry.keywords.trim())
    || (typeof entry?.what_or === 'string' && entry.what_or.trim()) // alias, mirrors careerjet.mjs
    || '';
  if (!keywords) throw new Error('linkedin: entry is missing `keywords` (or `what_or`)');
  const location = (typeof entry?.location === 'string' && entry.location.trim())
    || (typeof entry?.where === 'string' && entry.where.trim())
    || '';

  const params = new URLSearchParams({ keywords });
  if (location) params.set('location', location);
  return `${SEARCH_BASE}?${params.toString()}`;
}

/**
 * Strip LinkedIn's per-request tracking params (position/pageNum/refId/
 * trackingId) off a job card's href, leaving a clean URL that's stable across
 * calls for the same posting — confirmed live (see file header). Returns null
 * for anything that doesn't parse as an absolute https URL.
 *
 * @param {string} rawHref
 * @returns {string | null}
 */
export function canonicalizeLinkedInUrl(rawHref) {
  if (typeof rawHref !== 'string' || !rawHref) return null;
  let parsed;
  try {
    parsed = new URL(decodeEntities(rawHref));
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  return `${parsed.origin}${parsed.pathname}`;
}

/**
 * Parse LinkedIn's guest job-search HTML into normalized jobs. Exported for
 * unit tests. Cards are located by their stable `data-entity-urn` marker and
 * sliced up to the next marker (or end of document) — no HTML parser
 * dependency, same convention as this project's other regex-based feed
 * providers (teamtailor.mjs, personio.mjs).
 *
 * @param {string} html
 * @param {string} [fallbackCompany]
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseLinkedInSearchHtml(html, fallbackCompany) {
  if (typeof html !== 'string' || !html) return [];
  const markers = [...html.matchAll(MARKER_RE)];
  const jobs = [];

  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].index ?? 0;
    const end = i + 1 < markers.length ? (markers[i + 1].index ?? html.length) : html.length;
    const chunk = html.slice(start, end);

    const hrefMatch = chunk.match(/base-card__full-link[^"]*"\s+href="([^"]+)"/);
    const url = hrefMatch ? canonicalizeLinkedInUrl(hrefMatch[1]) : null;
    if (!url) continue;

    const titleMatch = chunk.match(/base-search-card__title">\s*([^<]+?)\s*<\/h3>/);
    const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : '';
    if (!title) continue;

    const companyMatch = chunk.match(/base-search-card__subtitle">[\s\S]*?<a[^>]*>\s*([^<]+?)\s*<\/a>/);
    const company = companyMatch ? decodeEntities(companyMatch[1]).trim() : (fallbackCompany || 'LinkedIn');

    const locationMatch = chunk.match(/job-search-card__location">\s*([^<]+?)\s*<\/span>/);
    const location = locationMatch ? decodeEntities(locationMatch[1]).trim() : '';

    /** @type {{title: string, url: string, company: string, location: string, postedAt?: number}} */
    const job = { title, url, company, location };

    const dateMatch = chunk.match(/job-search-card__listdate"\s+datetime="([^"]+)"/);
    if (dateMatch) {
      const ts = Date.parse(dateMatch[1]);
      if (Number.isFinite(ts)) job.postedAt = ts;
    }

    jobs.push(job);
  }

  return jobs;
}

/** @type {Provider} */
export default {
  id: 'linkedin',

  async fetch(entry, ctx) {
    const url = assertLinkedInUrl(buildLinkedInUrl(entry));
    const html = await ctx.fetchText(url, {
      redirect: 'error', // SSRF guard, same convention as every other provider
      headers: {
        // Default career-ops UA gets treated as a bot outright by LinkedIn's
        // guest page (undocumented, but this is the shared constant every
        // other WAF-sensitive provider in this project already reaches for —
        // see _http.mjs's own comment on it).
        'user-agent': BROWSER_LIKE_USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-IE,en;q=0.9',
      },
    });

    const jobs = parseLinkedInSearchHtml(html, entry?.name);
    if (jobs.length === 0) {
      // Zero results is indistinguishable here from a challenge/interstitial
      // response, a markup change upstream, or a genuinely quiet query — but
      // treating it as an error (rather than an empty-but-healthy board)
      // means it surfaces in scan.mjs's run summary instead of silently
      // looking fine. A genuinely quiet query is a rare, recoverable false
      // alarm; a silent breakage is not.
      throw new Error(
        'linkedin: 0 job cards parsed from the response — likely an interstitial/challenge page, ' +
          'an upstream markup change, or a query with no matches. Inspect the raw response before assuming this entry is broken.',
      );
    }
    return jobs;
  },
};
