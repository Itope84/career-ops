#!/usr/bin/env node
/**
 * archive-pipeline-entries.mjs — moves one or more `data/pipeline.md` Pending
 * entries to Processed as a pre-screen-gate skip, and logs the reason.
 *
 * WHY THIS EXISTS: the web app's Quick Triage feature used to hand-append a
 * raw row into data/applications.md on a discard decision — bypassing the
 * tracker's shared lock, atomic write, and score-cell validation entirely,
 * and never touching data/pipeline.md at all (so a "discarded" job kept
 * reappearing in the inbox on reload/another device — it was only ever
 * hidden client-side). This script does the ONE thing a triage discard
 * should actually do: the exact move `modes/pipeline.md`'s own pre-screen
 * gate already specifies for this case —
 *
 *   - [ ] {url} | Company | Role | Location | posted: 2026-09-01
 *   → (moved out of Pending, into Processed)
 *   - [x] #-- | {url} | skipped (pre-screen mismatch: {reason})
 *
 * plus the matching `data/discard.log` line that mode already specifies:
 *   {ISO8601}\t{url}\t{reason}
 *
 * No new file, no new convention — this is the pre-existing pre-screen-gate
 * behavior, just runnable as a standalone script the web app (or anything
 * else) can call, instead of only living inside the interactive pipeline
 * mode's instructions.
 *
 * Usage:
 *   echo '[{"url":"https://...","reason":"no marketing/ops overlap"}]' \
 *     | node archive-pipeline-entries.mjs
 *
 * Reads a JSON array of {url, reason} from stdin. Prints one JSON summary to
 * stdout: { archived: [...urls], notFound: [...urls] }. Exits non-zero only
 * on a hard failure (bad input, lock timeout, write failure) — a URL simply
 * not being found in Pending is reported in `notFound`, not a fatal error
 * (it may have already been archived, or processed by a real evaluation, by
 * the time this runs).
 */
import { readFileSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { trackerLockDirFor, acquireTrackerLock, writeFileAtomic } from './tracker-utils.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PIPELINE_PATH = join(ROOT, 'data', 'pipeline.md');
const DISCARD_LOG_PATH = join(ROOT, 'data', 'discard.log');

/** @param {string} url */
function urlOf(line) {
  // `- [ ] {url} | Company | Role | Location | posted: ...` — the url is
  // everything between the checkbox and the first `|` (or end of line).
  const m = line.match(/^-\s*\[\s*\]\s*(\S+)/);
  return m ? m[1] : null;
}

async function main() {
  const raw = readFileSync(0, 'utf-8'); // stdin
  /** @type {Array<{url: string, reason: string}>} */
  let entries;
  try {
    entries = JSON.parse(raw);
  } catch (err) {
    console.error(JSON.stringify({ error: `invalid JSON on stdin: ${err.message}` }));
    process.exit(1);
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    console.error(JSON.stringify({ error: 'expected a non-empty JSON array of {url, reason}' }));
    process.exit(1);
  }
  const targets = new Map();
  for (const e of entries) {
    if (e && typeof e.url === 'string' && e.url.trim()) {
      targets.set(e.url.trim(), typeof e.reason === 'string' && e.reason.trim() ? e.reason.trim() : 'pre-screen mismatch');
    }
  }
  if (targets.size === 0) {
    console.error(JSON.stringify({ error: 'no valid {url, reason} entries in input' }));
    process.exit(1);
  }

  const lockDir = trackerLockDirFor(PIPELINE_PATH);
  let lock;
  try {
    lock = await acquireTrackerLock(lockDir, { tracker: PIPELINE_PATH });
  } catch (err) {
    console.error(JSON.stringify({ error: `could not lock data/pipeline.md: ${err.message}` }));
    process.exit(err?.code === 'LOCK_TIMEOUT' ? 4 : 1);
  }

  const archived = [];
  const notFound = [];
  try {
    const text = readFileSync(PIPELINE_PATH, 'utf-8');
    const lines = text.split('\n');

    const pendingIdx = lines.findIndex((l) => l.trim() === '## Pending');
    const processedIdx = lines.findIndex((l) => l.trim() === '## Processed');
    if (pendingIdx === -1 || processedIdx === -1) {
      throw new Error('data/pipeline.md is missing a ## Pending or ## Processed section');
    }

    const kept = [];
    const movedLines = [];
    for (let i = 0; i < lines.length; i++) {
      // Only touch lines inside the Pending section — a `- [ ]` line
      // elsewhere (there shouldn't be one, but never assume) is left alone.
      if (i > pendingIdx && i < processedIdx) {
        const url = urlOf(lines[i]);
        if (url && targets.has(url)) {
          movedLines.push(`- [x] #-- | ${url} | skipped (pre-screen mismatch: ${targets.get(url)})`);
          archived.push(url);
          continue;
        }
      }
      kept.push(lines[i]);
    }
    for (const url of targets.keys()) {
      if (!archived.includes(url)) notFound.push(url);
    }

    if (movedLines.length > 0) {
      // Re-locate "## Processed" in the filtered `kept` array (removing lines
      // above it shifted every index) and insert right after its heading —
      // newest skips at the top of the section, matching how new evaluated
      // entries are already inserted elsewhere in this file.
      const newProcessedIdx = kept.findIndex((l) => l.trim() === '## Processed');
      kept.splice(newProcessedIdx + 1, 0, '', ...movedLines);
      writeFileAtomic(PIPELINE_PATH, kept.join('\n'));

      const now = new Date().toISOString();
      const logLines = archived.map((url) => `${now}\t${url}\t${targets.get(url)}`).join('\n') + '\n';
      appendFileSync(DISCARD_LOG_PATH, logLines, 'utf-8');
    }
  } finally {
    lock.release();
  }

  console.log(JSON.stringify({ archived, notFound }));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
