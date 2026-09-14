// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Adzuna provider — keyword-first aggregator search (UK-native, 20 countries):
// https://developer.adzuna.com/docs/search
//
// WHY THIS EXISTS: scan.mjs is company-first and reaches ATS APIs only
// (Greenhouse/Lever/Ashby/Workday/...). Whole sectors — UK charity/voluntary
// especially — run no supported ATS, which portals.yml's "Non-ATS Sector Orgs"
// search_query documents and patches with a DuckDuckGo HTML scrape. Adzuna
// covers that gap with a real API and a first-class `charity-voluntary-jobs`
// category, without needing per-org endpoint curation.
//
// TRADE-OFF (read before trusting a hit): Adzuna is an aggregator of job
// boards, not a source of record. Two consequences:
//   1. `url` is an adzuna.co.uk redirect, NOT a direct apply link. It resolves
//      to the real posting in a browser, but check-liveness.mjs sees Adzuna's
//      redirector, so liveness signal is weaker than a direct ATS hit.
//   2. The same role is syndicated from several boards with a DIFFERENT
//      redirect_url each — so scan.mjs's URL-keyed dedup cannot collapse them.
//      This provider dedups on company+title itself (see DEDUP below), but that
//      only covers ONE fetch. Across runs scan.mjs re-reads scan-history.tsv,
//      which is URL-keyed, so redirect_url must also be STABLE per ad or every
//      scan re-adds the same jobs as new — see canonicalizeAdzunaUrl below.
// A direct ATS entry in tracked_companies always beats an Adzuna hit for the
// same org. Adzuna is the net for orgs that have no reachable ATS at all.
//
// CREDENTIALS: needs ADZUNA_APP_ID / ADZUNA_APP_KEY in .env (gitignored).
// Free tier at https://developer.adzuna.com. This is the first provider that
// requires credentials — absent keys are a hard, explicit error rather than an
// empty board, so a silent zero-result scan can't be mistaken for "no new jobs".
//
// Wire in via a `job_boards:` entry with `provider: adzuna`.

import { decodeEntities } from './_html-entities.mjs';

const API_HOST = 'api.adzuna.com';
const API_BASE = `https://${API_HOST}/v1/api/jobs`;
const PER_PAGE_MAX = 50; // Adzuna's hard cap
const DEFAULT_PER_PAGE = 50;
const DEFAULT_MAX_PAGES = 3;
const MAX_PAGES_CAP = 20; // free tier is rate-limited; don't walk the whole index
const DEFAULT_COUNTRY = 'gb';

// Adzuna does not return a currency per-result — it is implicit from the
// country endpoint. This map covers every supported country so salary objects
// carry the right currency for scan.mjs's salary_filter.
const COUNTRY_CURRENCY = {
  gb: 'GBP', us: 'USD', at: 'EUR', au: 'AUD', be: 'EUR', br: 'BRL',
  ca: 'CAD', ch: 'CHF', de: 'EUR', es: 'EUR', fr: 'EUR', in: 'INR',
  it: 'EUR', mx: 'MXN', nl: 'EUR', nz: 'NZD', pl: 'PLN', sg: 'SGD',
  za: 'ZAR',
};

// Adzuna country codes (https://developer.adzuna.com/overview). Guarded so a
// typo'd country can't be pathed into the URL.
const COUNTRIES = new Set([
  'gb', 'us', 'at', 'au', 'be', 'br', 'ca', 'ch', 'de', 'es',
  'fr', 'in', 'it', 'mx', 'nl', 'nz', 'pl', 'sg', 'za',
]);

/**
 * Read credentials from the environment. scan.mjs loads dotenv before importing
 * providers, so .env values are already on process.env by the time fetch runs.
 *
 * @returns {{ appId: string, appKey: string }}
 */
function readCredentials() {
  const appId = (process.env.ADZUNA_APP_ID || '').trim();
  const appKey = (process.env.ADZUNA_APP_KEY || '').trim();
  if (!appId || !appKey) {
    const missing = [!appId && 'ADZUNA_APP_ID', !appKey && 'ADZUNA_APP_KEY'].filter(Boolean);
    throw new Error(
      `adzuna: missing ${missing.join(' and ')} — add to .env (free key: https://developer.adzuna.com). ` +
        `Set enabled: false on the Adzuna job_boards entry to skip it instead.`,
    );
  }
  return { appId, appKey };
}

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/** Resolve results_per_page: positive integer, clamped to Adzuna's 50 cap. */
function resolvePerPage(entry) {
  const v = entry?.results_per_page;
  if (Number.isInteger(v) && v > 0) return Math.min(v, PER_PAGE_MAX);
  return DEFAULT_PER_PAGE;
}

/** @param {any} entry */
function resolveCountry(entry) {
  const raw = typeof entry?.country === 'string' ? entry.country.trim().toLowerCase() : '';
  const country = raw || DEFAULT_COUNTRY;
  if (!COUNTRIES.has(country)) {
    throw new Error(
      `adzuna: unsupported country "${country}" — expected one of: ${[...COUNTRIES].join(', ')}`,
    );
  }
  return country;
}

/**
 * Build one search-page URL. Exported for unit tests.
 *
 * Query params are Adzuna's documented search fields — every one is optional
 * except the credentials, and only those present on the entry are sent:
 *   - what_or:      space-separated terms, ANY may match (the usual broad net)
 *   - what_phrase:  exact phrase match
 *   - what_exclude: space-separated terms that must NOT appear
 *   - where:        location string ("london")
 *   - distance:     km radius around `where`
 *   - category:     Adzuna category tag (e.g. "charity-voluntary-jobs")
 *   - max_days_old: recency cap
 *   - full_time / permanent: set to 1 when true
 *
 * @param {any} entry
 * @param {number} page
 * @param {{ appId: string, appKey: string }} creds
 * @returns {string}
 */
export function buildAdzunaUrl(entry, page, creds) {
  const country = resolveCountry(entry);
  const params = new URLSearchParams({
    app_id: creds.appId,
    app_key: creds.appKey,
    results_per_page: String(resolvePerPage(entry)),
    'content-type': 'application/json',
  });

  /** @param {string} key @param {unknown} val */
  const addStr = (key, val) => {
    if (typeof val === 'string' && val.trim()) params.set(key, val.trim());
  };
  /** @param {string} key @param {unknown} val */
  const addNum = (key, val) => {
    if (Number.isFinite(val) && Number(val) > 0) params.set(key, String(val));
  };

  addStr('what_or', entry?.what_or);
  addStr('what_phrase', entry?.what_phrase);
  addStr('what_exclude', entry?.what_exclude);
  addStr('where', entry?.where);
  addStr('category', entry?.category);
  addNum('distance', entry?.distance);
  addNum('max_days_old', entry?.max_days_old);
  if (entry?.full_time === true) params.set('full_time', '1');
  if (entry?.permanent === true) params.set('permanent', '1');

  return `${API_BASE}/${country}/search/${page}?${params.toString()}`;
}

/**
 * Collapse an Adzuna redirect_url to a stable, per-ad canonical form.
 * Exported for unit tests.
 *
 * WHY: scan.mjs's cross-run dedup keys on `url` via scan-history.tsv, but
 * Adzuna's redirect_url is not stable for a fixed ad. Two things move:
 *   1. `se=` is a per-call session token — it changes on EVERY API response.
 *   2. Adzuna serves the same numeric ad id under two paths, `/jobs/land/ad/{id}`
 *      and `/jobs/details/{id}`, depending on the response.
 * Either alone defeats a URL-keyed history, so each scan re-added roles it had
 * already seen and the pipeline grew by ~1 duplicate set per run.
 *
 * Canonical form is `/jobs/details/{id}` with no query string: that is the path
 * Adzuna itself serves without the `v=` verification hash, so it resolves
 * standalone. `v=` is stable per ad but only accompanies the /land/ad/ form —
 * dropping the query entirely keeps one key per ad across both paths.
 *
 * The host is preserved (adzuna.co.uk / .com / .de / ...) — country-specific
 * hosts are distinct sources of record, not duplicates.
 *
 * Falls back to stripping only the volatile params when no ad id is present,
 * so an unrecognized URL shape degrades to today's behavior rather than dropping.
 *
 * @param {URL} parsed - An already host-validated Adzuna URL.
 * @returns {string}
 */
export function canonicalizeAdzunaUrl(parsed) {
  const id = parsed.pathname.match(/\/jobs\/(?:land\/ad|details)\/(\d+)/)?.[1];
  if (id) return `${parsed.origin}/jobs/details/${id}`;

  const cleaned = new URL(parsed.href);
  for (const p of ['se', 'utm_medium', 'utm_source', 'utm_campaign']) {
    cleaned.searchParams.delete(p);
  }
  return cleaned.href;
}

/**
 * Normalize a single Adzuna result. Exported for unit tests.
 *
 * Field mapping → the normalized Job shape:
 *   - title:       `title`, HTML-entity-decoded and trimmed (no title → dropped).
 *   - url:         `redirect_url`, host-locked to *.adzuna.* over https, then
 *                  canonicalized per-ad so it is stable across scans (see
 *                  canonicalizeAdzunaUrl). This is a redirector, not a direct
 *                  apply link — see the header note.
 *   - company:     `company.display_name`, falling back to the entry name. Adzuna
 *                  often reports the posting AGENCY here, not the end employer;
 *                  the oferta gate's `via=` field exists for exactly this case.
 *   - location:    `location.display_name`.
 *   - description: `description` — free in the list payload, so scan.mjs's
 *                  content_filter can use it. NOTE: Adzuna truncates it with an
 *                  ellipsis; it is a filtering aid, never the full JD.
 *   - postedAt:    `created` (ISO 8601) → epoch ms (omitted when unparseable).
 *   - salary:      `{ min, max, currency }` when Adzuna supplies actual (not
 *                  predicted) salary bounds. `salary_is_predicted` results are
 *                  Adzuna's ML estimates, not advertised pay — unreliable for
 *                  filtering, so they are skipped. When absent, the salary field
 *                  is omitted entirely so scan.mjs's salary_filter passes the
 *                  job conservatively (no data ≠ below threshold).
 *
 * @param {any} j
 * @param {string} [fallbackCompany]
 * @param {string} [country] - Country code from the entry, used to derive currency.
 * @returns {{ title: string, url: string, company: string, location: string, description?: string, postedAt?: number, salary?: { min: number, max: number, currency: string } } | null}
 */
export function normalizeAdzunaJob(j, fallbackCompany, country) {
  if (!j || typeof j !== 'object') return null;

  const title = typeof j.title === 'string' ? decodeEntities(j.title).trim() : '';
  if (!title) return null;

  // Adzuna serves postings from country-specific hosts (adzuna.co.uk,
  // adzuna.com, adzuna.de, ...), so lock to the adzuna registrable domain
  // rather than one literal host. Anything off-domain is untrusted → dropped.
  let url = '';
  const rawUrl = typeof j.redirect_url === 'string' ? j.redirect_url.trim() : '';
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      const host = parsed.hostname.toLowerCase();
      // The suffix after `adzuna.` is bounded to 1-2 label groups. An unbounded
      // [a-z.]+ also matches `adzuna.co.uk.attacker.example` — a host an attacker
      // can register — which would defeat the domain lock entirely.
      const onAdzuna = host === 'adzuna.com' || /(^|\.)adzuna\.[a-z]{2,}(\.[a-z]{2,})?$/.test(host);
      if (parsed.protocol === 'https:' && onAdzuna) url = canonicalizeAdzunaUrl(parsed);
    } catch {
      // malformed URL → leave url = '' → dropped below
    }
  }
  if (!url) return null;

  const rawCompany = j.company?.display_name;
  const company =
    typeof rawCompany === 'string' && rawCompany.trim()
      ? decodeEntities(rawCompany).trim()
      : fallbackCompany || 'Adzuna';

  const rawLocation = j.location?.display_name;
  const location = typeof rawLocation === 'string' ? decodeEntities(rawLocation).trim() : '';

  /** @type {{ title: string, url: string, company: string, location: string, description?: string, postedAt?: number, salary?: { min: number, max: number, currency: string } }} */
  const job = { title, url, company, location };

  const desc = typeof j.description === 'string' ? decodeEntities(j.description).trim() : '';
  if (desc) job.description = desc;

  if (typeof j.created === 'string') {
    const ts = Date.parse(j.created);
    if (Number.isFinite(ts)) job.postedAt = ts;
  }

  // ── Salary extraction ──────────────────────────────────────────────
  // Adzuna returns salary_min / salary_max on most results, but also sets
  // salary_is_predicted when the values are its own ML estimates rather than
  // employer-advertised pay. Predicted salaries are unreliable for threshold
  // filtering (they skew low for non-profit roles), so we only emit the
  // salary object when the data is actual advertised compensation.
  // No server-side salary_min param is sent in the API call — that would
  // drop the many non-profit listings with no advertised salary entirely.
  if (!j.salary_is_predicted) {
    const sMin = Number(j.salary_min);
    const sMax = Number(j.salary_max);
    if ((Number.isFinite(sMin) && sMin > 0) || (Number.isFinite(sMax) && sMax > 0)) {
      const currency = COUNTRY_CURRENCY[country || DEFAULT_COUNTRY] || 'GBP';
      job.salary = {
        min: Number.isFinite(sMin) && sMin > 0 ? sMin : sMax,
        max: Number.isFinite(sMax) && sMax > 0 ? sMax : sMin,
        currency,
      };
    }
  }

  return job;
}

/**
 * DEDUP key: company+title, case/whitespace-normalized.
 *
 * Aggregator-specific. scan.mjs dedups on `url`, which is the right key for a
 * source of record (one posting = one URL) but useless here: Adzuna syndicates
 * one role from N boards as N results with N distinct redirect_urls. Without
 * this, a single job lands in the pipeline several times.
 *
 * @param {{ company: string, title: string }} job
 */
function dedupKey(job) {
  const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return `${norm(job.company)} ${norm(job.title)}`;
}

/** @type {Provider} */
export default {
  id: 'adzuna',

  async fetch(entry, ctx) {
    const creds = readCredentials();
    // ctx.maxPages is verify-portals.mjs's health probe asking for page 1 only.
    const maxPages = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0
      ? Math.min(ctx.maxPages, resolveMaxPages(entry))
      : resolveMaxPages(entry);
    const perPage = resolvePerPage(entry);
    const fallbackCompany = entry?.name;
    const country = resolveCountry(entry);

    const out = [];
    const seen = new Set();

    for (let page = 1; page <= maxPages; page++) {
      const url = buildAdzunaUrl(entry, page, creds);
      // redirect:'error' prevents SSRF via server-side redirects
      const json = await ctx.fetchJson(url, { redirect: 'error' });
      if (!json || !Array.isArray(json.results)) {
        // Don't leak the credentialed URL into logs on failure.
        throw new Error(
          `adzuna: unexpected API response on page ${page} — expected { results: [...] }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`,
        );
      }

      for (const j of json.results) {
        const normalized = normalizeAdzunaJob(j, fallbackCompany, country);
        if (!normalized) continue;
        const key = dedupKey(normalized);
        if (seen.has(key)) continue; // syndicated duplicate — see DEDUP above
        seen.add(key);
        out.push(normalized);
      }

      if (json.results.length < perPage) break; // short page → last page reached
      if (ctx?.sleep) await ctx.sleep(250); // free tier is rate-limited
    }

    return out;
  },
};
