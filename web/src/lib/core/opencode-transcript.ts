/**
 * opencode-transcript.ts — reads opencode's OWN sqlite database.
 *
 * opencode keeps a full, permanent transcript of every session it ever ran —
 * every message, every reasoning block, every tool call — in
 * `~/.local/share/opencode/opencode.db` (WAL mode, safe to read while
 * opencode is actively writing to it). We never knew this existed until we
 * went looking for why a "failed" scan-broad run gave no clue what went
 * wrong: the run's own opencode session showed it had in fact finished
 * cleanly (`finish: "stop"`) with the correct VERDICT line, while our own
 * capture — a rolling 4000-char tail of raw stdout, kept only in memory for
 * the life of one HTTP request — had already been thrown away.
 *
 * This file is READ-ONLY by contract. Nothing here ever writes to opencode's
 * database — it is opencode's own state, not ours.
 *
 * Everything in this file is best-effort and MUST NEVER affect whether a job
 * succeeds or fails: sqlite3 might not be installed, the db might not exist
 * yet (opencode never run), a query might race a concurrent write. Every
 * function here returns null/empty on any failure rather than throwing.
 */
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const OPENCODE_DB_PATH = path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");

function runQuery<T>(sql: string): T[] | null {
  try {
    const out = execFileSync("sqlite3", ["-readonly", "-json", OPENCODE_DB_PATH, sql], {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
    return out ? (JSON.parse(out) as T[]) : [];
  } catch {
    return null; // sqlite3 missing, db missing/locked, or malformed JSON — never throw
  }
}

/** Single-quote escaping for a SQL string literal. `id` is always an id
 *  opencode itself generated (ses_.../msg_...), never raw user input — but
 *  escaped anyway rather than trusted. */
function sqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * Find the opencode session THIS run just created, by looking for the
 * earliest `session` row created at/after `sinceMs`.
 *
 * Correlation is by timing, not an id we control — opencode assigns its own
 * internal session id the moment it boots, with no way for us to pass one in
 * or read one back from stdout/stderr without either changing the CLI's
 * output format (risks destabilizing every other parser downstream of it) or
 * piping its `--print-logs` INFO stream into the same stderr `sawError`
 * scans (confirmed unsafe: a totally benign "failed to initialize fff" file-
 * picker warning contains the words "failed" and "error", and would start
 * flagging clean runs as failed).
 *
 * Not a hard guarantee: two opencode invocations starting within the same
 * ~2s window (another concurrent job, or an unrelated interactive `opencode`
 * session on this machine) could in principle collide. Acceptable for a
 * debugging aid — nothing else depends on this being exactly right, and a
 * misattributed id just means the "load transcript" button on the wrong job
 * points at a very-nearby-in-time session instead of the exact one.
 *
 * Polls briefly because the session row lags a beat behind spawn() returning
 * (bootstrapping, config loading — typically 100-300ms per the observed logs).
 */
export async function findOpencodeSessionId(sinceMs: number): Promise<string | null> {
  const deadline = Date.now() + 4000;
  const since = sinceMs - 500; // clock-skew slack between our timestamp and opencode's own
  while (Date.now() < deadline) {
    const rows = runQuery<{ id: string }>(`select id from session where time_created >= ${since} order by time_created asc limit 1;`);
    if (rows && rows.length > 0) return rows[0].id;
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

export type TranscriptPart = { type: string; [key: string]: unknown };
export type TranscriptMessage = { id: string; role: string; createdAt: number; parts: TranscriptPart[] };

/**
 * The full transcript for one opencode session: every message opencode
 * recorded, each with every part it generated (reasoning, text, tool calls),
 * in order. This is the real conversation — not a summary, not our own
 * partial capture.
 *
 * Returns null when nothing can be read (missing sqlite3, missing db,
 * unknown session id) so callers can tell "no transcript available" apart
 * from "transcript is empty".
 */
export function readOpencodeTranscript(sessionId: string): TranscriptMessage[] | null {
  const messages = runQuery<{ id: string; data: string; time_created: number }>(
    `select id, data, time_created from message where session_id = ${sqlStr(sessionId)} order by time_created asc;`,
  );
  if (!messages || messages.length === 0) return null;

  const partRows = runQuery<{ message_id: string; data: string }>(
    `select message_id, data from part where session_id = ${sqlStr(sessionId)} order by id asc;`,
  );
  const partsByMessage = new Map<string, TranscriptPart[]>();
  for (const p of partRows ?? []) {
    let parsed: TranscriptPart;
    try {
      parsed = JSON.parse(p.data) as TranscriptPart;
    } catch {
      parsed = { type: "unknown" };
    }
    const arr = partsByMessage.get(p.message_id) ?? [];
    arr.push(parsed);
    partsByMessage.set(p.message_id, arr);
  }

  return messages.map((m) => {
    let role = "unknown";
    try {
      role = (JSON.parse(m.data) as { role?: string }).role ?? "unknown";
    } catch {
      /* leave "unknown" */
    }
    return { id: m.id, role, createdAt: m.time_created, parts: partsByMessage.get(m.id) ?? [] };
  });
}
