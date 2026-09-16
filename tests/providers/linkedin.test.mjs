// tests/providers/linkedin.test.mjs — pure logic tests for the LinkedIn guest
// search-page provider (added 2026-09-13). No network calls: the HTML fixture
// below is a trimmed, structurally faithful copy of a real response captured
// live against https://www.linkedin.com/jobs/search (see providers/linkedin.mjs's
// header for the verification story).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — linkedin');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/linkedin.mjs')).href);
  const linkedin = mod.default;
  const { buildLinkedInUrl, canonicalizeLinkedInUrl, parseLinkedInSearchHtml } = mod;

  if (linkedin.id === 'linkedin') pass('linkedin.id is "linkedin"');
  else fail(`linkedin.id is ${JSON.stringify(linkedin.id)}`);

  if (typeof linkedin.detect === 'undefined') {
    pass('linkedin has no detect() — job_boards entries always set provider: linkedin explicitly');
  } else {
    fail('linkedin should not export detect() (it is a keyword-search job_boards provider, not a tracked_companies one)');
  }

  // buildLinkedInUrl()
  const url1 = buildLinkedInUrl({ keywords: 'Marketing Executive', location: 'Galway, Ireland' });
  if (url1 === 'https://www.linkedin.com/jobs/search?keywords=Marketing+Executive&location=Galway%2C+Ireland') {
    pass('buildLinkedInUrl() builds keywords+location query string');
  } else {
    fail(`buildLinkedInUrl() returned ${url1}`);
  }

  const url2 = buildLinkedInUrl({ what_or: 'Operations Coordinator' });
  if (url2 === 'https://www.linkedin.com/jobs/search?keywords=Operations+Coordinator') {
    pass('buildLinkedInUrl() accepts what_or as a keywords alias and omits location when absent');
  } else {
    fail(`buildLinkedInUrl() returned ${url2}`);
  }

  try {
    buildLinkedInUrl({});
    fail('buildLinkedInUrl({}) should throw when keywords is missing');
  } catch (err) {
    if (/missing `keywords`/.test(err.message)) pass('buildLinkedInUrl() throws a clear error when keywords is missing');
    else fail(`buildLinkedInUrl({}) threw an unexpected error: ${err.message}`);
  }

  // canonicalizeLinkedInUrl()
  const rawHref =
    'https://ie.linkedin.com/jobs/view/marketing-executive-at-arcon-recruitment-ireland-4465021485?position=1&amp;pageNum=0&amp;refId=abc%3D%3D&amp;trackingId=def%3D%3D';
  const canon = canonicalizeLinkedInUrl(rawHref);
  // The fixture href is ie.linkedin.com and the expected result is www: the
  // provider normalises LinkedIn's country subdomain. Searching never used the
  // country host (SEARCH_BASE is pinned to www and ALLOWED_HOST throws on
  // anything else) — the country host only ever appeared in the RESULT
  // permalinks, and both hosts serve the identical posting (verified live on an
  // Irish job: same role, same location, same JD text, byte-for-byte length).
  if (canon === 'https://www.linkedin.com/jobs/view/marketing-executive-at-arcon-recruitment-ireland-4465021485') {
    pass('canonicalizeLinkedInUrl() decodes entities, strips tracking params and normalises the country host to www');
  } else {
    fail(`canonicalizeLinkedInUrl() returned ${canon}`);
  }

  if (canonicalizeLinkedInUrl('not a url') === null) {
    pass('canonicalizeLinkedInUrl() returns null for an unparseable href');
  } else {
    fail('canonicalizeLinkedInUrl() should return null for an unparseable href');
  }

  if (canonicalizeLinkedInUrl('http://ie.linkedin.com/jobs/view/x-1') === null) {
    pass('canonicalizeLinkedInUrl() rejects non-https URLs');
  } else {
    fail('canonicalizeLinkedInUrl() should reject non-https URLs');
  }

  // parseLinkedInSearchHtml() — two cards, structurally faithful to a real
  // captured response (see file header of providers/linkedin.mjs).
  const sampleHtml = `
    <ul class="jobs-search__results-list">
      <li>
        <div class="base-card relative w-full base-search-card base-search-card--link job-search-card" data-entity-urn="urn:li:jobPosting:4465021485" data-impression-id="jobs-search-desktop-0">
          <a class="base-card__full-link absolute top-0" href="https://ie.linkedin.com/jobs/view/marketing-executive-at-arcon-recruitment-ireland-4465021485?position=1&amp;pageNum=0&amp;refId=abc&amp;trackingId=def">
            <span class="sr-only">Marketing Executive</span>
          </a>
          <div class="base-search-card__info">
            <h3 class="base-search-card__title">
              Marketing Executive
            </h3>
            <h4 class="base-search-card__subtitle">
              <a class="hidden-nested-link" href="https://ie.linkedin.com/company/arcon-recruitment-ireland">
                Arcon Recruitment Ireland
              </a>
            </h4>
            <div class="base-search-card__metadata">
              <span class="job-search-card__location">
                County Mayo, Ireland
              </span>
              <time class="job-search-card__listdate" datetime="2026-09-09">
                3 days ago
              </time>
            </div>
          </div>
        </div>
      </li>
      <li>
        <div class="base-card relative w-full base-search-card base-search-card--link job-search-card" data-entity-urn="urn:li:jobPosting:4435956871" data-impression-id="jobs-search-desktop-1">
          <a class="base-card__full-link absolute top-0" href="https://ie.linkedin.com/jobs/view/digital-marketing-executive-at-jfc-group-4435956871?position=2&amp;pageNum=0">
            <span class="sr-only">Digital Marketing Executive</span>
          </a>
          <div class="base-search-card__info">
            <h3 class="base-search-card__title">
              Digital Marketing Executive
            </h3>
            <h4 class="base-search-card__subtitle">
              <a class="hidden-nested-link" href="https://ie.linkedin.com/company/jfc-group">
                JFC Group
              </a>
            </h4>
            <div class="base-search-card__metadata">
              <span class="job-search-card__location">
                Tuam, County Galway, Ireland
              </span>
              <time class="job-search-card__listdate" datetime="2026-07-10">
                2 months ago
              </time>
            </div>
          </div>
        </div>
      </li>
    </ul>
  `;

  const jobs = parseLinkedInSearchHtml(sampleHtml, 'LinkedIn');
  if (jobs.length === 2) pass('parseLinkedInSearchHtml() extracts 2 cards from 2-card fixture');
  else fail(`parseLinkedInSearchHtml() returned ${jobs.length} jobs, expected 2`);

  const j0 = jobs[0];
  if (
    j0?.title === 'Marketing Executive' &&
    j0?.company === 'Arcon Recruitment Ireland' &&
    j0?.location === 'County Mayo, Ireland' &&
    j0?.url === 'https://www.linkedin.com/jobs/view/marketing-executive-at-arcon-recruitment-ireland-4465021485'
  ) {
    pass('parseLinkedInSearchHtml() extracts title/company/location/url correctly');
  } else {
    fail(`parseLinkedInSearchHtml() job[0] = ${JSON.stringify(j0)}`);
  }

  if (j0?.postedAt === Date.parse('2026-09-09')) {
    pass('parseLinkedInSearchHtml() parses the datetime attribute into postedAt, not the "N days ago" text');
  } else {
    fail(`parseLinkedInSearchHtml() job[0].postedAt = ${j0?.postedAt}`);
  }

  if (jobs[1]?.title === 'Digital Marketing Executive' && jobs[1]?.company === 'JFC Group') {
    pass('parseLinkedInSearchHtml() correctly isolates the second card (no bleed from the first)');
  } else {
    fail(`parseLinkedInSearchHtml() job[1] = ${JSON.stringify(jobs[1])}`);
  }

  if (parseLinkedInSearchHtml('<html><body>no cards here</body></html>').length === 0) {
    pass('parseLinkedInSearchHtml() returns [] for HTML with no job cards');
  } else {
    fail('parseLinkedInSearchHtml() should return [] when no data-entity-urn markers are present');
  }

  // fetch() — zero-cards response must throw, not return []
  try {
    await linkedin.fetch(
      { keywords: 'Marketing Executive' },
      { fetchText: async () => '<html><body>interstitial</body></html>' },
    );
    fail('fetch() should throw on a zero-cards response instead of returning []');
  } catch (err) {
    if (/0 job cards parsed/.test(err.message)) pass('fetch() throws a clear error on a zero-cards response');
    else fail(`fetch() threw an unexpected error: ${err.message}`);
  }
  // posted_within_days → f_TPR (the ONE filter the guest endpoint honours;
  // f_WT/f_E/f_JT and every sort param were verified live to be ignored).
  const tpr = buildLinkedInUrl({ keywords: 'X', location: 'UK', posted_within_days: 5 });
  if (tpr.includes('f_TPR=r432000')) pass('buildLinkedInUrl() maps posted_within_days to f_TPR seconds');
  else fail(`buildLinkedInUrl() posted_within_days => ${tpr}`);

  const noTpr = [
    buildLinkedInUrl({ keywords: 'X', posted_within_days: 0 }),
    buildLinkedInUrl({ keywords: 'X', posted_within_days: -3 }),
    buildLinkedInUrl({ keywords: 'X', posted_within_days: 'soon' }),
    buildLinkedInUrl({ keywords: 'X' }),
  ];
  if (noTpr.every((u) => !u.includes('f_TPR'))) pass('buildLinkedInUrl() omits f_TPR for absent/zero/negative/non-numeric values');
  else fail(`buildLinkedInUrl() emitted f_TPR for an invalid value: ${noTpr.join(' | ')}`);

} catch (err) {
  fail(`linkedin provider test crashed: ${err.message}`);
}
