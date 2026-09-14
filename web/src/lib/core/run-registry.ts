import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWrite } from "@/lib/core/safe-write";

// Durable, connection-independent record of every worker run this server has
// started. The web is a single local Node process (same assumption the old
// tracker-write lock already made), so an in-memory Map is the source of
// truth at runtime — snapshotted to disk on every change so a server restart
// doesn't erase history, and so a browser that reconnects (new tab, different
// device, or just a dropped connection) can ask "what's actually running?"
// instead of inferring it from a stream that may already be dead.
//
// WHY THIS EXISTS: /api/run's only way of reporting done/error used to be one
// more NDJSON line on the SAME SSE stream the client opened. The child process
// is deliberately never killed on disconnect (see /api/run's cancel()) — the
// work really does finish — but the result had nowhere durable to land, so a
// closed tab just looked like "connection lost" forever, even though a report
// was sitting on disk. This registry is that durable landing spot.

export type JobKind = "evaluate" | "pdf" | "research" | "fix-portal" | "scan-broad" | "scan" | "triage";
/** "queued" = accepted and durable, but waiting for a concurrency slot before
 *  its CLI child is spawned (see job-queue.ts). Distinct from "running" so the
 *  UI can say "waiting" instead of showing 99 identical spinners. */
export type JobStatus = "queued" | "running" | "done" | "error" | "timeout";

export type JobRecord = {
  id: string;
  kind: JobKind;
  title: string;
  subtitle?: string;
  input: string;
  status: JobStatus;
  startedAt: number;
  endedAt?: number;
  result?: { score: number | null; reason?: string; tokens?: number; costUsd?: number };
  error?: string;
  /** Generic payload slot for a kind whose "done" result isn't a score — e.g.
   *  triage's array of {id, decision, reason} classifications. Most kinds
   *  never set this. */
  data?: unknown;
  /** opencode's own internal session id (ses_...), when this job ran on
   *  opencode. Set best-effort, shortly after spawn, by correlating timing
   *  against opencode's own sqlite database (see lib/core/opencode-transcript.ts)
   *  — opencode assigns this itself; we have no way to pass one in. Its
   *  presence is also what the UI uses to decide whether a "load full
   *  transcript" option makes sense for a job — never set for any other CLI. */
  opencodeSessionId?: string;
};

const SNAPSHOT_PATH = () => path.join(careerOpsRoot(), ".career-ops-web", "job-registry.json");
// Bound both how much history disk-snapshots and how much a GET ever returns —
// this is operational state for "what's running / what recently failed", not
// an audit log; unbounded growth here is a slow memory + disk leak, not a
// feature. Comfortably covers "what happened in the last day or so" for a
// single-user local tool.
const MAX_RECORDS = 300;

const jobs = new Map<string, JobRecord>();

// ── tracker-write mutex (pre-existing, unchanged contract) ───────────────────
// `tracker.mjs delete` (#1200) does NOT yet share a file lock with
// merge-tracker (a documented follow-up — merge-tracker isn't import-safe), so
// a row delete must not run while a worker is mid-merge or one of the two
// writes is lost. The delete route serializes against this — coarse (the
// whole run), but correct: we never delete while an evaluation is in flight.
let writeSeq = 0;
const writing = new Set<number>();

/** Mark that a tracker-writing run has started; returns a token to release with. */
export function acquireTrackerWrite(): number {
  const token = ++writeSeq;
  writing.add(token);
  return token;
}

export function releaseTrackerWrite(token: number): void {
  writing.delete(token);
}

/** True while any evaluation/pdf run that mutates applications.md is in flight. */
export function isTrackerWriting(): boolean {
  return writing.size > 0;
}

// ── job registry ─────────────────────────────────────────────────────────

function persist(): void {
  try {
    const arr = [...jobs.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, MAX_RECORDS);
    atomicWrite(SNAPSHOT_PATH(), JSON.stringify(arr));
  } catch {
    // Non-fatal: worst case a server restart loses history, same as before
    // this feature existed. Never let a snapshot failure break the run itself.
  }
}

/** Load the on-disk snapshot into memory. Call once, at module init. */
function hydrate(): void {
  let raw: string;
  try {
    raw = fs.readFileSync(SNAPSHOT_PATH(), "utf8");
  } catch {
    return; // no prior snapshot — fresh start, nothing to reconcile
  }
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return; // corrupt snapshot — treat as fresh rather than crash the server
  }
  if (!Array.isArray(arr)) return;
  for (const rec of arr) {
    if (!rec || typeof rec !== "object" || typeof (rec as JobRecord).id !== "string") continue;
    const r = rec as JobRecord;
    // A job that was still "running" in the last snapshot did not survive the
    // restart — its child process is gone with the old server process, so it
    // can never actually finish. Reconcile it honestly instead of showing a
    // spinner for a job nothing is running anymore.
    // "queued" is equally dead: the concurrency queue is in-memory (job-queue.ts),
    // so a job still waiting for a slot was never spawned and has nothing left
    // to wake it. Left alone it would sit as "queued" forever.
    if (r.status === "running" || r.status === "queued") {
      const wasQueued = r.status === "queued";
      r.status = "error";
      r.error = wasQueued
        ? "Server restarted while this was still waiting in the queue — it never started. Re-run it."
        : "Interrupted by a server restart before it finished.";
      r.endedAt = r.endedAt ?? Date.now();
    }
    jobs.set(r.id, r);
  }
}

hydrate();

/** Register a newly-started job. Overwrites any prior record with the same id. */
export function registerJob(
  rec: Omit<JobRecord, "status" | "startedAt"> & { startedAt?: number; status?: Extract<JobStatus, "queued" | "running"> },
): void {
  jobs.set(rec.id, { ...rec, status: rec.status ?? "running", startedAt: rec.startedAt ?? Date.now() });
  persist();
}

/** Patch an existing job record (status transition, result, error, etc.). No-ops if the id is unknown. */
export function updateJob(id: string, patch: Partial<Omit<JobRecord, "id">>): void {
  const cur = jobs.get(id);
  if (!cur) return;
  jobs.set(id, { ...cur, ...patch });
  persist();
}

export function getJob(id: string): JobRecord | null {
  return jobs.get(id) ?? null;
}

/** All known jobs, newest first. Optionally filtered to a single status. */
export function listJobs(status?: JobStatus): JobRecord[] {
  const all = [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt);
  return status ? all.filter((j) => j.status === status) : all;
}
