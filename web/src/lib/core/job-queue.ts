/**
 * job-queue.ts — a server-side concurrency gate for CLI worker spawns.
 *
 * WHY
 * ---
 * "Score all" loops `startJob` over every shortlisted role and each one POSTs
 * to /api/run, which spawns a CLI child. With 99 roles that is 99 simultaneous
 * agent processes. That is not survivable: it exhausted RAM, drove the machine
 * into swap (11.7M pageouts, ~280 MB/s of thrash), and starved all three
 * career-ops instances on this host until none of them could answer a request.
 * The frontend was not at fault — nothing anywhere imposed a ceiling.
 *
 * WHERE THE QUEUE LIVES, AND WHY IT IS NOT IN THE BROWSER
 * ------------------------------------------------------
 * Server-side, deliberately. A client-side queue dies with the tab, and the
 * entire point of the durable job registry is that work survives a closed tab,
 * a dropped connection, and a reload. Queue 99 jobs in the browser and 94 of
 * them evaporate the moment someone navigates away — the exact failure this
 * codebase spent the night eliminating everywhere else.
 *
 * So /api/run awaits a slot here BEFORE it spawns. A request that is waiting
 * costs one idle HTTP connection and nothing else; the expensive thing was
 * always the child process, never the socket. Because the route handler keeps
 * running server-side after the client goes away, a queued job still starts
 * when its turn comes even if the tab was closed minutes earlier.
 *
 * FAIRNESS
 * --------
 * Strict FIFO. A batch of 99 drains in submission order rather than whichever
 * promise the runtime happens to wake first, so progress is predictable and
 * the UI's "queued" counts mean something.
 *
 * THE ONE RULE
 * ------------
 * Every acquire() MUST be matched by exactly one release(), on every path —
 * success, error, timeout, client disconnect, thrown exception. A leaked slot
 * permanently shrinks the pool, and a pool that shrinks to zero wedges every
 * future job with no visible error. Call release() from a `finally`, or from a
 * single guarded teardown that every terminal path runs through.
 */

/** Max CLI workers running at once. Deliberately small: each one is a full
 *  agent process with a model session, not a lightweight request. 5 is the
 *  measured-safe default for a dev machine also running three Next.js servers;
 *  raise it with JOB_CONCURRENCY only if you have watched memory while a batch
 *  is in flight. */
const DEFAULT_LIMIT = 5;

function limit(): number {
  const raw = Number(process.env.JOB_CONCURRENCY);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_LIMIT;
}

let active = 0;
const waiting: Array<() => void> = [];

/** Resolves when a slot is free. Await this immediately before spawning. */
export function acquireSlot(): Promise<void> {
  if (active < limit()) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waiting.push(() => {
      active++;
      resolve();
    });
  });
}

/** Hand the slot back. Idempotent per caller only — call it exactly once per
 *  successful acquire(), never speculatively. */
export function releaseSlot(): void {
  active = Math.max(0, active - 1);
  // Only wake someone if there is genuinely room; limit() is read fresh each
  // time so JOB_CONCURRENCY can be lowered without a restart wedging the pool.
  while (waiting.length > 0 && active < limit()) {
    const next = waiting.shift();
    if (next) next();
  }
}

/** For the UI / diagnostics: how loaded the pool is right now. */
export function queueStats(): { active: number; waiting: number; limit: number } {
  return { active, waiting: waiting.length, limit: limit() };
}
