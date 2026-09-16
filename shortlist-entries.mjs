#!/usr/bin/env node
/**
 * shortlist-entries.mjs — MOVES entries between data/pipeline.md's sections:
 * out of `## Pending` (the inbox) and into `## Shortlisted`, or back out of
 * `## Shortlisted` again.
 *
 * "Move" is literal and load-bearing: a shortlisted role must LEAVE the
 * inbox, not appear in both places. The first version of this script only
 * added to `## Shortlisted` and left the `- [ ]` line sitting in `## Pending`,
 * so a "saved" role still showed up in the inbox — exactly the bug this
 * project's own inbox UX kept hitting.
 *
 * Shortlisted entries are plain bullets
 * (`- {url} | {company} | {role} | {location?}`),
 * deliberately NOT `- [ ]`/`- [x]` checkboxes: career-ops.ts's readInbox()
 * sweeps every checkbox line in the WHOLE file regardless of section, so a
 * checkbox-style shortlist entry would leak straight back into the inbox and
 * its counts. Plain bullets are invisible to that regex by construction.
 *
 * Usage (batch form preferred — one lock, one atomic write for the whole set):
 *   echo '{"op":"add","items":[{"url":"...","company":"...","role":"..."}]}' | node shortlist-entries.mjs
 *   echo '{"op":"remove","items":[{"url":"..."}]}'                          | node shortlist-entries.mjs
 *   echo '{"op":"remove","url":"...","restore":true}'                       | node shortlist-entries.mjs
 *
 * Single-item form still works:
 *   echo '{"op":"add","url":"...","company":"...","role":"..."}'            | node shortlist-entries.mjs
 *
 * Prints a JSON summary:
 *   { ok: true, moved: [...urls], alreadyThere: [...urls], restored: [...urls] }.
 * `moved` is the set actually taken out of Pending; a url that wasn't in
 * Pending (already shortlisted, already processed) is not an error — it's
 * reported separately and the shortlist entry is still written/deduped.
 *
 * `remove` has TWO meanings, and the caller picks which:
 *   - default (`restore` absent/false): the entry is dropped from
 *     `## Shortlisted` and goes nowhere — a real delete.
 *   - `restore: true`: the entry MOVES BACK into `## Pending` as a
 *     `- [ ]` checkbox line, i.e. un-bookmarking returns the role to the
 *     inbox. Company/role are recovered from the shortlist bullet itself
 *     (`- {url} | {company} | {role}`), so the caller doesn't have to
 *     re-supply what this file already knows.
 * These are the web app's two shortlist-card controls: the bookmark toggle
 * (restore) and the ✗ (delete).
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { trackerLockDirFor, acquireTrackerLock, writeFileAtomic } from './tracker-utils.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PIPELINE_PATH = join(ROOT, 'data', 'pipeline.md');
const PENDING_HEADING = '## Pending';
const SHORTLIST_HEADING = '## Shortlisted';

/** url from a plain shortlist bullet: `- {url} | ...` */
function bulletUrl(line) {
  const m = line.match(/^-\s+(\S+)/);
  return m && !/^\[[ xX]\]$/.test(m[1]) ? m[1] : null;
}

/** url from an inbox checkbox line: `- [ ] {url} | ...` */
function checkboxUrl(line) {
  const m = line.match(/^-\s*\[[ xX]\]\s*(\S+)/);
  return m ? m[1] : null;
}

/** Split the file into its preamble + ordered `## ` sections, preserving order. */
function parseSections(lines) {
  const preamble = [];
  const sections = [];
  let cur = null;
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      cur = { heading: line, body: [] };
      sections.push(cur);
    } else if (cur) {
      cur.body.push(line);
    } else {
      preamble.push(line);
    }
  }
  return { preamble, sections };
}

function serialize(preamble, sections) {
  const out = [...preamble];
  for (const s of sections) out.push(s.heading, ...s.body);
  return out.join('\n');
}

async function main() {
  const raw = readFileSync(0, 'utf-8');
  let input;
  try {
    input = JSON.parse(raw);
  } catch (err) {
    console.error(JSON.stringify({ error: `invalid JSON on stdin: ${err.message}` }));
    process.exit(1);
  }

  const op = input.op;
  if (op !== 'add' && op !== 'remove') {
    console.error(JSON.stringify({ error: 'op must be "add" or "remove"' }));
    process.exit(1);
  }

  // Accept either the batch `items` array or the single-item shorthand.
  const rawItems = Array.isArray(input.items) ? input.items : [input];
  const items = [];
  for (const it of rawItems) {
    if (!it || typeof it.url !== 'string' || !it.url.trim()) continue;
    const entry = { url: it.url.trim() };
    if (op === 'add') {
      if (typeof it.company !== 'string' || typeof it.role !== 'string') {
        console.error(JSON.stringify({ error: `company and role are required for op "add" (url: ${entry.url})` }));
        process.exit(1);
      }
      entry.company = it.company;
      entry.role = it.role;
      // Optional 4th column, mirroring the inbox line shape. Before this the
      // bullet carried only url|company|role, so bookmarking a role silently
      // DROPPED its location and the shortlist card had nothing to show.
      if (typeof it.location === 'string' && it.location.trim()) entry.location = it.location.trim();
    }
    items.push(entry);
  }
  if (items.length === 0) {
    console.error(JSON.stringify({ error: 'no valid items — each needs a url (plus company + role for "add")' }));
    process.exit(1);
  }
  if (!existsSync(PIPELINE_PATH)) {
    console.error(JSON.stringify({ error: 'data/pipeline.md does not exist' }));
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

  const restore = op === 'remove' && input.restore === true;
  const moved = [];
  const alreadyThere = [];
  const restored = [];
  try {
    const { preamble, sections } = parseSections(readFileSync(PIPELINE_PATH, 'utf-8').split('\n'));

    let shortlist = sections.find((s) => s.heading.trim() === SHORTLIST_HEADING);
    if (!shortlist) {
      // Self-heals a checkout that predates this feature — no separate migration step.
      shortlist = { heading: SHORTLIST_HEADING, body: [''] };
      sections.push(shortlist);
    }
    const pending = sections.find((s) => s.heading.trim() === PENDING_HEADING);

    const targets = new Set(items.map((it) => it.url));

    // Always drop any existing shortlist bullet for these urls — on "add"
    // that's a dedupe before re-inserting, on "remove" it's the whole job.
    // Keep the dropped lines: a `restore` needs the company/role they carry.
    const dropped = shortlist.body.filter((l) => targets.has(bulletUrl(l) ?? ''));
    shortlist.body = shortlist.body.filter((l) => !targets.has(bulletUrl(l) ?? ''));

    if (restore && dropped.length > 0) {
      // Put them back where they came from, as inbox checkbox lines. If the
      // file somehow has no `## Pending` (hand-edited, or a fresh checkout),
      // create it rather than silently dropping the role on the floor.
      let pendingSection = pending;
      if (!pendingSection) {
        pendingSection = { heading: PENDING_HEADING, body: [''] };
        sections.unshift(pendingSection);
      }
      const alreadyPending = new Set(pendingSection.body.map((l) => checkboxUrl(l)).filter(Boolean));
      const lines = [];
      for (const l of dropped) {
        const u = bulletUrl(l);
        if (!u || alreadyPending.has(u)) continue;
        lines.push(l.replace(/^-\s+/, '- [ ] '));
        restored.push(u);
      }
      pendingSection.body.unshift(...lines);
    }

    if (op === 'add') {
      // THE MOVE: take them out of the inbox section. Record what was
      // actually there BEFORE filtering — afterwards everything looks absent.
      const wasInPending = new Set();
      if (pending) {
        for (const l of pending.body) {
          const u = checkboxUrl(l);
          if (u && targets.has(u)) wasInPending.add(u);
        }
        pending.body = pending.body.filter((l) => !targets.has(checkboxUrl(l) ?? ''));
      }
      for (const it of items) {
        (wasInPending.has(it.url) ? moved : alreadyThere).push(it.url);
      }
      // Newest first, matching how this file's other sections read.
      shortlist.body.unshift(
        ...items.map((it) =>
          it.location
            ? `- ${it.url} | ${it.company} | ${it.role} | ${it.location}`
            : `- ${it.url} | ${it.company} | ${it.role}`,
        ),
      );
    }

    writeFileAtomic(PIPELINE_PATH, serialize(preamble, sections));
  } finally {
    lock.release();
  }

  console.log(JSON.stringify({ ok: true, moved, alreadyThere, restored }));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
