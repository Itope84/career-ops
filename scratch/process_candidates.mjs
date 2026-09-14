import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { execSync } from 'child_process';
import {
  loadSeenUrls,
  buildTitleFilter,
  buildLocationFilter,
  formatScanHistoryRow,
  formatPipelineOffer,
} from '../scan.mjs';

// CWD is /Users/temitope/temitops
const CWD = '/Users/temitope/temitops';

async function resolveUrl(url) {
  if (!url.startsWith('https://vertexaisearch.cloud.google.com/grounding-api-redirect/')) {
    return url;
  }
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return res.url;
  } catch (err) {
    try {
      const res = await fetch(url, { method: 'GET', redirect: 'follow' });
      return res.url;
    } catch (e) {
      console.error(`Failed to resolve redirect for ${url}:`, e.message);
      return url;
    }
  }
}

async function main() {
  console.log('Starting Broad Portal Search processing script...');

  // 1. Load config
  const config = yaml.load(fs.readFileSync('portals.yml', 'utf-8'));
  const titleFilter = buildTitleFilter(config.title_filter);
  const locationFilter = buildLocationFilter(config.location_filter);

  // 2. Load candidates
  const rawCandidates = JSON.parse(fs.readFileSync('scratch/candidates.json', 'utf-8'));
  console.log(`Loaded ${rawCandidates.length} raw candidates from WebSearch.`);

  // 3. Load seen URLs and company+role keys
  const seenUrlState = loadSeenUrls({});
  const seenUrls = seenUrlState.seen;

  // Load history URLs specifically to avoid writing duplicates into scan-history.tsv
  const historyUrls = new Set();
  if (fs.existsSync('data/scan-history.tsv')) {
    const lines = fs.readFileSync('data/scan-history.tsv', 'utf-8').split('\n');
    for (const line of lines.slice(1)) {
      const [url] = line.split('\t');
      if (url) historyUrls.add(url);
    }
  }

  // 4. Resolve redirects (with limited concurrency to avoid WAF/rate limits)
  console.log('Resolving redirect URLs...');
  const candidates = [];
  const CONCURRENCY = 10;
  for (let i = 0; i < rawCandidates.length; i += CONCURRENCY) {
    const batch = rawCandidates.slice(i, i + CONCURRENCY);
    const promises = batch.map(async (cand) => {
      const resolvedUrl = await resolveUrl(cand.url);
      return { ...cand, resolvedUrl };
    });
    const resolvedBatch = await Promise.all(promises);
    candidates.push(...resolvedBatch);
    console.log(`Resolved redirects: ${candidates.length}/${rawCandidates.length}`);
  }

  // Today is 2026-08-13
  const date = '2026-08-13';

  // Resolved tracked companies (GitLab, Anthropic, Spotify)
  const resolvedTrackedCompanies = new Set(['gitlab', 'anthropic', 'spotify']);

  const toHistory = []; // { offer, status }
  const toPipeline = [];

  let totalFound = candidates.length;
  let skippedTracked = 0;
  let filteredTitle = 0;
  let filteredLocation = 0;
  let dupes = 0;
  let expired = 0;
  let added = 0;

  const uniqueCandidates = [];
  const seenFinalUrlsInBatch = new Set();

  for (const cand of candidates) {
    // Check if the final URL was already processed in this batch to avoid internal duplicates
    if (seenFinalUrlsInBatch.has(cand.resolvedUrl)) {
      continue;
    }
    seenFinalUrlsInBatch.add(cand.resolvedUrl);
    uniqueCandidates.push(cand);
  }

  // First pass: filter and classify
  const livenessCheckList = [];

  for (const cand of uniqueCandidates) {
    const url = cand.resolvedUrl;
    const company = cand.company;
    const title = cand.title;
    const location = cand.location;
    const portal = cand.portal;

    const normCompany = company.toLowerCase().trim();

    // 1. Skip already resolved tracked companies
    if (resolvedTrackedCompanies.has(normCompany) || url.includes('gitlab.com') || url.includes('anthropic.com') || url.includes('spotify.com')) {
      skippedTracked++;
      continue;
    }

    const offer = {
      url,
      title,
      company,
      location,
      source: portal,
      postedAt: null,
      description: '',
      salary: null
    };

    // 2. Title Filter
    if (!titleFilter(title)) {
      filteredTitle++;
      if (!historyUrls.has(url)) {
        toHistory.push({ offer, status: 'skipped_title' });
      }
      continue;
    }

    // 3. Location Filter
    if (!locationFilter(location)) {
      filteredLocation++;
      if (!historyUrls.has(url)) {
        toHistory.push({ offer, status: 'skipped_location' });
      }
      continue;
    }

    // 4. Deduplicate
    if (seenUrls.has(url)) {
      dupes++;
      if (!historyUrls.has(url)) {
        toHistory.push({ offer, status: 'skipped_dup' });
      }
      continue;
    }

    // Survives filtering and dedup -> Needs liveness check
    livenessCheckList.push(offer);
  }

  console.log(`Filtering complete:
  - Total candidates: ${totalFound}
  - Skipped (already resolved tracked): ${skippedTracked}
  - Filtered by title: ${filteredTitle}
  - Filtered by location: ${filteredLocation}
  - Duplicate: ${dupes}
  - Needs liveness check: ${livenessCheckList.length}`);

  // Liveness Check
  if (livenessCheckList.length > 0) {
    const urls = livenessCheckList.map(o => o.url);
    console.log(`Running check-liveness.mjs on ${urls.length} URLs...`);

    // We execute check-liveness.mjs with --no-fallback to keep it fully headless
    // We pass urls in batches of 15 to avoid command line length limits
    const batchSize = 15;
    const livenessResults = {}; // url -> 'active' | 'expired' | 'uncertain'

    for (let i = 0; i < urls.length; i += batchSize) {
      const urlBatch = urls.slice(i, i + batchSize);
      const cmd = `node check-liveness.mjs --no-fallback ${urlBatch.map(u => `'${u}'`).join(' ')}`;
      try {
        console.log(`Running: node check-liveness.mjs batch ${i/batchSize + 1}`);
        const stdout = execSync(cmd, { cwd: CWD, encoding: 'utf-8' });
        // Parse stdout
        const lines = stdout.split('\n');
        for (const line of lines) {
          if (line.includes('active') || line.includes('expired') || line.includes('uncertain')) {
            const urlMatch = line.match(/(https?:\/\/\S+)/);
            if (urlMatch) {
              const u = urlMatch[1].trim();
              if (line.includes('✅ active')) {
                livenessResults[u] = 'active';
              } else if (line.includes('❌ expired')) {
                livenessResults[u] = 'expired';
              } else {
                livenessResults[u] = 'uncertain';
              }
            }
          }
        }
      } catch (err) {
        console.error('check-liveness command error:', err.message);
        // If the process exited non-zero but returned stdout, we can still parse it
        if (err.stdout) {
          const lines = err.stdout.split('\n');
          for (const line of lines) {
            if (line.includes('active') || line.includes('expired') || line.includes('uncertain')) {
              const urlMatch = line.match(/(https?:\/\/\S+)/);
              if (urlMatch) {
                const u = urlMatch[1].trim();
                if (line.includes('✅ active')) {
                  livenessResults[u] = 'active';
                } else if (line.includes('❌ expired')) {
                  livenessResults[u] = 'expired';
                } else {
                  livenessResults[u] = 'uncertain';
                }
              }
            }
          }
        }
      }
    }

    // Process liveness check results
    for (const offer of livenessCheckList) {
      const status = livenessResults[offer.url] || 'expired'; // Default to expired if not found/uncertain
      if (status === 'active') {
        added++;
        toPipeline.push(offer);
        toHistory.push({ offer, status: 'added' });
      } else {
        expired++;
        if (!historyUrls.has(offer.url)) {
          toHistory.push({ offer, status: 'skipped_expired' });
        }
      }
    }
  }

  // 5. Append to data/pipeline.md
  if (toPipeline.length > 0) {
    console.log(`Appending ${toPipeline.length} new offers to pipeline.md...`);
    const pipelinePath = 'data/pipeline.md';
    let text = fs.readFileSync(pipelinePath, 'utf-8');

    // Format matches formatPipelineOffer but let's make sure:
    // Format: - [ ] {url} | {company} | {title}
    // Note that we want to format it exactly as specified by prompt:
    // "- [ ] {url} | {company} | {title}" or with trailing fields.
    // Let's use formatPipelineOffer or construct the string directly to match prompt:
    // "Append to data/pipeline.md's Pending section: - [ ] {url} | {company} | {title}"
    const block = toPipeline.map(o => formatPipelineOffer(o)).join('\n') + '\n';

    const marker = '## Pending';
    const idx = text.indexOf(marker);
    if (idx !== -1) {
      const afterMarker = idx + marker.length;
      const nextSection = text.indexOf('\n## ', afterMarker);
      const insertAt = nextSection === -1 ? text.length : nextSection;
      text = text.slice(0, insertAt) + '\n' + block + text.slice(insertAt);
    } else {
      text += `\n## Pending\n\n` + block;
    }
    fs.writeFileSync(pipelinePath, text, 'utf-8');
  }

  // 6. Record rows in data/scan-history.tsv
  if (toHistory.length > 0) {
    console.log(`Writing ${toHistory.length} rows to scan-history.tsv...`);
    const historyPath = 'data/scan-history.tsv';
    if (!fs.existsSync(historyPath)) {
      fs.writeFileSync(historyPath, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\tjd_fingerprint\tpostedAt\n', 'utf-8');
    }

    const newRows = toHistory.map(({ offer, status }) => {
      return formatScanHistoryRow(offer, date, status);
    }).join('\n') + '\n';

    fs.appendFileSync(historyPath, newRows, 'utf-8');
  }

  // Output Summary
  console.log(`\nPortal Scan — ${date}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Queries executed: 15`);
  console.log(`Offers found: ${totalFound} total`);
  console.log(`Filtered by title: ${filteredTitle} relevant`);
  console.log(`Duplicates: ${dupes} (already evaluated or in pipeline)`);
  console.log(`Expired discarded: ${expired} (dead links, Level 3)`);
  console.log(`New added to pipeline.md: ${added}`);
  if (toPipeline.length > 0) {
    console.log('');
    for (const o of toPipeline) {
      console.log(`  + ${o.company} | ${o.title} | ${o.source}`);
    }
  }
  console.log(`\n→ Run the \`pipeline\` mode to evaluate the new offers (\`/career-ops pipeline\` where available, or ask the agent to run \`pipeline\`).`);

  // Output verdict (which will be captured and printed by the caller)
  const verdictScore = added >= 1 ? 5 : 2;
  console.log(`FINAL_VERDICT_VAL: VERDICT: ${verdictScore}/5 — ${added} new role(s) added to your inbox`);
}

main().catch(err => {
  console.error('Fatal error in process script:', err.message);
  process.exit(1);
});
