#!/usr/bin/env node
/**
 * reconcile-report.mjs — make sure a written report actually REACHES the tracker.
 *
 * WHY THIS EXISTS
 * ---------------
 * modes/oferta.md's persistence sequence is five steps:
 *   1. reserve a report number      (reserve-report-num.mjs → NNN-RESERVED.md)
 *   2. write the report             (reports/NNN-{slug}-{date}.md)
 *   3. stage a tracker row          (batch/tracker-additions/NNN-{slug}.tsv)
 *   4. merge it                     (merge-tracker.mjs → data/applications.md)
 *   5. clean up the inbox entry
 *
 * The worker dying between 2 and 4 is not hypothetical — it is the single most
 * common way this pipeline fails. `opencode run` routinely stalls mid-step, so
 * a run can produce a complete, correct, fully-written report and then simply
 * stop before the row is merged. The web app sees a real report, calls the job
 * done, drops the role from the shortlist — and the evaluation is invisible in
 * the Evaluated tab forever. Eleven reports were recovered by hand this way in
 * one sitting; this script is that recovery, made deterministic.
 *
 * It finishes steps 3 and 4 from the report itself, which already contains
 * every field the tracker row needs (its Machine Summary block plus the
 * header). It never invents anything: if a field isn't in the report, the row
 * isn't written.
 *
 * Idempotent and safe to call on every finished evaluation:
 *   - already in the tracker      → no-op
 *   - TSV already staged          → just merges
 *   - neither                     → synthesizes the TSV, then merges
 *
 * Usage:
 *   node reconcile-report.mjs --report 078-confidential-arcon-2026-09-14.md
 *   node reconcile-report.mjs --url https://example.com/job/123
 *   node reconcile-report.mjs --all      # sweep every orphaned report
 *
 * Prints JSON: { ok, status, report?, trackerRow?, error? }
 *   status: "already-tracked" | "merged" | "no-data" | "not-found" | "merge-failed"
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = join(ROOT, 'reports');
const TRACKER = join(ROOT, 'data', 'applications.md');
const ADDITIONS_DIR = join(ROOT, 'batch', 'tracker-additions');

function readTracker() {
  try {
    return readFileSync(TRACKER, 'utf8');
  } catch {
    return '';
  }
}

/** Report files, excluding reservation placeholders (empty, not real reports). */
function reportFiles() {
  try {
    return readdirSync(REPORTS_DIR).filter((f) => f.endsWith('.md') && !f.endsWith('-RESERVED.md'));
  } catch {
    return [];
  }
}

/**
 * Pull the tracker-row fields out of a report. Everything comes from the
 * report's own Machine Summary block (the canonical, machine-readable copy)
 * with the header as fallback — nothing is guessed. Returns null when the
 * report lacks what a valid row needs, so a malformed report is skipped
 * rather than merged as a half-row.
 */
export function fieldsFromReport(filename) {
  const path = join(REPORTS_DIR, filename);
  if (!existsSync(path)) return null;
  const c = readFileSync(path, 'utf8');

  const num = (filename.match(/^(\d{3})-/) || [])[1];
  const date = (c.match(/\*\*Date:\*\*\s*(\S+)/) || [])[1];
  const ms = (c.match(/```yaml([\s\S]*?)```/) || [])[1] || '';
  const fromSummary = (key) => {
    const m = ms.match(new RegExp('^' + key + ':\\s*"?(.*?)"?\\s*$', 'm'));
    return m ? m[1].trim() : '';
  };

  const heading = (c.match(/^# Evaluation:\s*(.+)$/m) || [])[1] || '';
  const [headCompany, ...headRest] = heading.split(' — ');
  const company = fromSummary('company') || headCompany?.trim() || '';
  const role = fromSummary('role') || headRest.join(' — ').trim() || '';
  const score = fromSummary('score') || (c.match(/\*\*Score:\*\*\s*([\d.]+)/) || [])[1] || '';
  const note = (fromSummary('next_action') || '').replace(/[\t\n]/g, ' ').slice(0, 150);

  // Agency-mediated postings record the real employer as "?" and name the
  // agency separately — the tracker needs that as a TAGGED via= field, never
  // a bare positional column (merge-tracker rejects ambiguous extras).
  const viaLine = ((c.match(/\*\*Via:\*\*\s*(.+)/) || [])[1] || '').trim();
  const unknownEmployer = company === '?' || company === '';
  let via = '';
  if (unknownEmployer) {
    via = viaLine.split('(')[0].trim().replace(/[—–-]\s*$/, '').trim();
    if (!via || via === '—' || via === '-' || /^direct\b/i.test(via)) via = '';
  }

  if (!num || !date || !company || !role || !score) return null;
  return { num, date, company, role, score, note, via, filename };
}

function tsvRow(f) {
  // 9 tab-separated columns, status BEFORE score (see AGENTS.md); the report
  // link is written root-relative — merge-tracker rewrites it relative to the
  // tracker's own directory.
  const cells = [f.num, f.date, f.company, f.role, 'Evaluated', `${f.score}/5`, '❌', `[${f.num}](reports/${f.filename})`, f.note];
  return cells.join('\t') + (f.via ? `\tvia=${f.via}` : '') + '\n';
}

function slugFor(company) {
  const s = (company === '?' ? 'unknown' : company).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return s || 'unknown';
}

function runMergeTracker() {
  try {
    const out = execFileSync(process.execPath, [join(ROOT, 'merge-tracker.mjs')], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { ok: true, out };
  } catch (err) {
    return { ok: false, out: err?.stdout || '', error: err?.message || String(err) };
  }
}

/**
 * Ensure ONE report is represented in the tracker. See the header for the
 * three cases it handles.
 */
export function reconcileReport(filename) {
  if (!existsSync(join(REPORTS_DIR, filename))) return { ok: false, status: 'not-found', report: filename };

  const tracker = readTracker();
  if (tracker.includes(filename)) return { ok: true, status: 'already-tracked', report: filename };

  // Filename alone is not proof of absence. A tracker row's link can point at
  // a DIFFERENT report number than the file that actually exists — seen live:
  // row #119 (OC Recruitment) linked to `108-oc-recruitment-…md` while the
  // real file on disk was `119-oc-recruitment-…md`, because the worker's own
  // numbering slipped between reserving and writing. Matching only on
  // filename would treat that posting as untracked and try to add it a second
  // time. The POSTING URL is the real identity, so check whether any report
  // the tracker DOES reference already covers this same URL.
  const url = ((readFileSync(join(REPORTS_DIR, filename), 'utf8').match(/\*\*URL:\*\*\s*(\S+)/) || [])[1] || '').trim();
  if (url) {
    for (const other of reportFiles()) {
      if (other === filename || !tracker.includes(other)) continue;
      try {
        const m = readFileSync(join(REPORTS_DIR, other), 'utf8').match(/\*\*URL:\*\*\s*(\S+)/);
        if (m && m[1].trim() === url) return { ok: true, status: 'already-tracked', report: filename, via: other };
      } catch {
        /* unreadable sibling — ignore */
      }
    }
  }

  const fields = fieldsFromReport(filename);
  if (!fields) return { ok: false, status: 'no-data', report: filename, error: 'report is missing the fields a tracker row needs' };

  // Only stage a TSV if one isn't already waiting (the worker may have got as
  // far as step 3 before dying) — re-staging would merge the same row twice.
  mkdirSync(ADDITIONS_DIR, { recursive: true });
  const staged = readdirSync(ADDITIONS_DIR).some((f) => {
    try {
      return readFileSync(join(ADDITIONS_DIR, f), 'utf8').includes(filename);
    } catch {
      return false;
    }
  });
  if (!staged) writeFileSync(join(ADDITIONS_DIR, `${fields.num}-${slugFor(fields.company)}.tsv`), tsvRow(fields));

  const merged = runMergeTracker();
  const nowTracked = readTracker().includes(filename);
  if (nowTracked) return { ok: true, status: 'merged', report: filename };
  // merge-tracker legitimately SKIPS a row when the same company+role is
  // already tracked with an equal-or-better score — that is not a failure,
  // the posting is already represented.
  const skipped = /⏭️\s+Skip/.test(merged.out || '');
  if (skipped) return { ok: true, status: 'already-tracked', report: filename };
  return { ok: false, status: 'merge-failed', report: filename, error: merged.error || 'merge-tracker did not add the row' };
}

/** Every report with no tracker row. */
export function orphanReports() {
  const tracker = readTracker();
  return reportFiles().filter((f) => !tracker.includes(f)).sort();
}

if (process.argv[1] && process.argv[1].endsWith('reconcile-report.mjs')) {
  const argv = process.argv.slice(2);
  const flag = (n) => {
    const i = argv.indexOf(n);
    return i === -1 ? null : argv[i + 1] ?? '';
  };

  if (argv.includes('--all')) {
    const results = orphanReports().map(reconcileReport);
    console.log(JSON.stringify({ ok: results.every((r) => r.ok), count: results.length, results }, null, 2));
    process.exit(results.every((r) => r.ok) ? 0 : 1);
  }

  let target = flag('--report');
  const url = flag('--url');
  if (!target && url) {
    target = reportFiles().find((f) => {
      try {
        const m = readFileSync(join(REPORTS_DIR, f), 'utf8').match(/\*\*URL:\*\*\s*(\S+)/);
        return m && m[1].trim() === url.trim();
      } catch {
        return false;
      }
    });
    if (!target) {
      console.log(JSON.stringify({ ok: false, status: 'not-found', error: `no report carries URL ${url}` }));
      process.exit(1);
    }
  }
  if (!target) {
    console.error('usage: reconcile-report.mjs (--report <file.md> | --url <posting-url> | --all)');
    process.exit(1);
  }

  const res = reconcileReport(target);
  console.log(JSON.stringify(res));
  process.exit(res.ok ? 0 : 1);
}
