// tests/providers/adzuna.test.mjs — covers the per-ad URL canonicalization that
// keeps scan.mjs's URL-keyed cross-run dedup working. Adzuna's redirect_url is
// not stable for a fixed ad (rotating `se=` token; two paths for one ad id), so
// without canonicalization every scan re-adds the same roles as new.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — Adzuna');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/adzuna.mjs')).href);
  const adzuna = mod.default;
  const { canonicalizeAdzunaUrl, normalizeAdzunaJob } = mod;

  if (adzuna.id === 'adzuna') pass('adzuna.id is "adzuna"');
  else fail(`adzuna.id is ${JSON.stringify(adzuna.id)}`);

  const canon = u => canonicalizeAdzunaUrl(new URL(u));

  // The rotating `se=` token is the core defect: same ad, four scans, four URLs.
  const seVariants = [
    'https://www.adzuna.co.uk/jobs/land/ad/5801554539?se=hlTlqWyB8RGnGfZ-Vm2jGw&utm_medium=api&utm_source=cc57cf57&v=8AF0EF37',
    'https://www.adzuna.co.uk/jobs/land/ad/5801554539?se=qo6h1G2B8RGuXZiVwx-Xkw&utm_medium=api&utm_source=cc57cf57&v=8AF0EF37',
    'https://www.adzuna.co.uk/jobs/land/ad/5801554539?se=tOef5m2B8RGBgLcYqW5wtQ&utm_medium=api&utm_source=cc57cf57&v=8AF0EF37',
  ].map(canon);
  if (new Set(seVariants).size === 1) {
    pass('rotating se= token collapses to one URL');
  } else {
    fail(`se= variants did not collapse: ${JSON.stringify(seVariants)}`);
  }

  // Adzuna serves one ad id under both paths — stripping se= alone misses this.
  const landing = canon('https://www.adzuna.co.uk/jobs/land/ad/5791627281?se=abc&v=DEF');
  const details = canon('https://www.adzuna.co.uk/jobs/details/5791627281?utm_medium=api&utm_source=cc57cf57');
  if (landing === details) {
    pass('/jobs/land/ad/{id} and /jobs/details/{id} collapse to the same URL');
  } else {
    fail(`paths did not collapse: ${landing} vs ${details}`);
  }

  if (landing === 'https://www.adzuna.co.uk/jobs/details/5791627281') {
    pass('canonical form is /jobs/details/{id} with no query string');
  } else {
    fail(`unexpected canonical form: ${landing}`);
  }

  // Distinct ads must stay distinct — over-collapsing would silently drop jobs.
  if (canon('https://www.adzuna.co.uk/jobs/land/ad/111?se=x') !== canon('https://www.adzuna.co.uk/jobs/land/ad/222?se=x')) {
    pass('different ad ids stay distinct');
  } else {
    fail('different ad ids collapsed into one URL');
  }

  // Country hosts are separate sources of record, not duplicates.
  if (canon('https://www.adzuna.de/jobs/details/999') !== canon('https://www.adzuna.co.uk/jobs/details/999')) {
    pass('country-specific hosts are preserved');
  } else {
    fail('country hosts collapsed into one URL');
  }

  // Unrecognized shape → degrade to stripping volatile params, never drop.
  const odd = canon('https://www.adzuna.co.uk/jobs/search?se=abc&utm_source=cc57cf57&q=fundraising');
  if (!odd.includes('se=') && !odd.includes('utm_source') && odd.includes('q=fundraising')) {
    pass('unrecognized URL shape strips volatile params and keeps the rest');
  } else {
    fail(`fallback stripping wrong: ${odd}`);
  }

  // End-to-end through the normalizer, which is what scan.mjs actually calls.
  const job = normalizeAdzunaJob({
    title: 'Philanthropy Manager',
    redirect_url: 'https://www.adzuna.co.uk/jobs/land/ad/5783171495?se=rotating&utm_medium=api&v=CD25DE90',
    company: { display_name: 'Missing People' },
    location: { display_name: 'London, UK' },
    created: '2026-07-01T00:00:00Z',
  });
  if (job?.url === 'https://www.adzuna.co.uk/jobs/details/5783171495') {
    pass('normalizeAdzunaJob() emits the canonical URL');
  } else {
    fail(`normalizeAdzunaJob() url = ${JSON.stringify(job?.url)}`);
  }

  // Off-domain redirect_url must still be rejected, canonicalization or not.
  const evil = normalizeAdzunaJob({
    title: 'Evil',
    redirect_url: 'https://adzuna.co.uk.attacker.example/jobs/details/1',
    company: { display_name: 'X' },
    location: { display_name: 'Y' },
  });
  if (evil === null) pass('off-domain redirect_url is still dropped');
  else fail(`off-domain URL survived: ${JSON.stringify(evil?.url)}`);
} catch (err) {
  fail(`Adzuna provider test threw: ${err.stack || err.message}`);
}
