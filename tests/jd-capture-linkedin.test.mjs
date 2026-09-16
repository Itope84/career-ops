// tests/jd-capture-linkedin.test.mjs — LinkedIn guest-JD path in jd-capture.mjs.
// No network: fetchLinkedInJd takes an injectable fetchImpl, and the HTML below
// mirrors the real guest jobPosting response (description__text wrapper, the
// show-more button that closes it, page chrome on either side).
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\njd-capture — LinkedIn guest JD');

try {
  const { fetchLinkedInJd, linkedInJobId } = await import(
    pathToFileURL(join(ROOT, 'jd-capture.mjs')).href
  );

  // linkedInJobId()
  const ids = [
    ['https://www.linkedin.com/jobs/view/sr-frontend-engineer-at-crowdstrike-4429852609', '4429852609'],
    ['https://uk.linkedin.com/jobs/view/4429852609', '4429852609'],
    // percent-encoded £ and + in the slug — real temitops URLs look like this
    ['https://www.linkedin.com/jobs/view/eng-%C2%A3100k-%2B-equity-at-x-4460243244', '4460243244'],
    ['https://boards.greenhouse.io/acme/jobs/123456', null],
    ['not a url', null],
    ['', null],
  ];
  const badId = ids.find(([u, want]) => String(linkedInJobId(u)) !== String(want));
  if (!badId) pass('linkedInJobId() extracts the posting id and rejects non-LinkedIn URLs');
  else fail(`linkedInJobId(${badId[0]}) => ${linkedInJobId(badId[0])}, want ${badId[1]}`);

  const HTML = `<html><body>
    <h1>Sr. Frontend Engineer</h1>
    <span>Over 200 applicants</span>
    <a href="/signup">Join or sign in to find your next job</a>
    <div class="description__text description__text--rich">
      <p>Build things &amp; ship them.</p>
      <ul><li>5+ years experience</li><li>TypeScript &amp; React</li></ul>
      <br>Salary &pound;100,000
    </div>
    <button class="show-more-less-html__button">Show more</button>
    <footer>LinkedIn Corporation &copy; 2026</footer>
  </body></html>`;

  const okFetch = async () => ({ ok: true, text: async () => HTML });
  const text = await fetchLinkedInJd('https://www.linkedin.com/jobs/view/x-4429852609', { fetchImpl: okFetch });

  if (text.includes('Build things & ship them') && text.includes('TypeScript & React')) {
    pass('fetchLinkedInJd() returns the description body with entities decoded');
  } else {
    fail(`fetchLinkedInJd() body => ${JSON.stringify(text.slice(0, 160))}`);
  }

  // The whole point of descriptionSection(): page chrome must not reach scoring.
  if (!/Join or sign in|Over 200 applicants|LinkedIn Corporation/.test(text)) {
    pass('fetchLinkedInJd() strips surrounding page chrome (sign-in prompt, applicant count, footer)');
  } else {
    fail(`fetchLinkedInJd() leaked chrome => ${JSON.stringify(text.slice(0, 200))}`);
  }

  if (!/<[a-z/!]/i.test(text)) pass('fetchLinkedInJd() returns text with no markup left in it');
  else fail(`fetchLinkedInJd() left markup => ${JSON.stringify(text.slice(-120))}`);

  if (text.includes('£100,000')) pass('fetchLinkedInJd() decodes numeric/named entities in the body');
  else fail('fetchLinkedInJd() did not decode &pound;');

  // A JD fetch must never be able to fail a scan.
  const nonLinkedIn = await fetchLinkedInJd('https://boards.greenhouse.io/a/jobs/1', { fetchImpl: okFetch });
  const notOk = await fetchLinkedInJd('https://www.linkedin.com/jobs/view/x-4429852609', {
    fetchImpl: async () => ({ ok: false, status: 429, text: async () => 'rate limited' }),
  });
  const threw = await fetchLinkedInJd('https://www.linkedin.com/jobs/view/x-4429852609', {
    fetchImpl: async () => { throw new Error('network down'); },
  });
  if (nonLinkedIn === '' && notOk === '' && threw === '') {
    pass('fetchLinkedInJd() returns "" for non-LinkedIn URLs, non-2xx responses and network errors');
  } else {
    fail(`fetchLinkedInJd() error paths => ${JSON.stringify([nonLinkedIn, notOk, threw])}`);
  }
} catch (err) {
  fail(`jd-capture linkedin test crashed: ${err.message}`);
}
