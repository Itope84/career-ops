import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveCli } from "@/lib/clis";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWrite } from "@/lib/core/safe-write";
import { extractJsonObject } from "@/lib/core/extract-json";
import { buildCoverPrompt } from "@/lib/cover/prompt";
import { coerceEnvelope, type CoverEnvelope, type CoverSession } from "@/lib/cover/types";

// On-disk, poll-based cover-letter sessions. Each turn spawns the user's BYO CLI
// headless, and the CLI's final JSON envelope is written back to the session
// file — the modal polls GET /api/cover/[id] rather than holding a socket, so
// closing the modal / reloading resumes exactly where it left off.

const TURN_KILL_MS = 300_000; // per-turn budget (research + draft + PDF render)
const STALE_MS = TURN_KILL_MS + 30_000; // a "thinking" older than this is dead → error

function sessionsDir(): string {
  return path.join(careerOpsRoot(), ".career-ops-web", "cover-sessions");
}
function sessionPath(id: string): string {
  return path.join(sessionsDir(), `${id}.json`);
}
function logPath(id: string): string {
  return path.join(sessionsDir(), `${id}.log`);
}

// Keep spawned children referenced so the event loop can't collect them before
// their close handler writes the result (mirrors the run route's detached-child
// pattern). Survives across requests because the Next server process is long-lived.
const INFLIGHT: Set<ChildProcess> = ((globalThis as { __coCoverInflight?: Set<ChildProcess> }).__coCoverInflight ??= new Set());

function log(id: string, msg: string): void {
  try {
    fs.mkdirSync(sessionsDir(), { recursive: true });
    fs.appendFileSync(logPath(id), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* logging is best-effort */
  }
}

export function readSession(id: string): CoverSession | null {
  try {
    return JSON.parse(fs.readFileSync(sessionPath(id), "utf8")) as CoverSession;
  } catch {
    return null;
  }
}

export function writeSession(s: CoverSession): void {
  s.updatedAt = Date.now();
  atomicWrite(sessionPath(s.id), JSON.stringify(s, null, 2));
}

export function createSession(input: { reportNum: string | null; jd: string | null; company: string; cliId: string }): CoverSession {
  const now = Date.now();
  const s: CoverSession = {
    id: `cover-${randomUUID()}`,
    reportNum: input.reportNum,
    jd: input.jd,
    company: input.company,
    cliId: input.cliId,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    status: "thinking",
    transcript: [],
    current: null,
    result: null,
    error: null,
  };
  writeSession(s);
  return s;
}

/** If a session is stuck in "thinking" past the staleness window (e.g. the dev
 *  server restarted mid-turn and the child died), flip it to a retryable error.
 *  Returns the possibly-updated session. */
export function reapIfStale(s: CoverSession): CoverSession {
  if (s.status === "thinking" && Date.now() - s.startedAt > STALE_MS) {
    s.status = "error";
    s.error = "This step stalled (the run didn't finish). Retry to continue where you left off.";
    writeSession(s);
  }
  return s;
}

/** Spawn one agent turn for the session in the BACKGROUND. Sets status:thinking,
 *  returns immediately; the child's close handler parses the envelope and writes
 *  the result. Caller has already pushed any user answers onto the transcript. */
export function spawnTurn(session: CoverSession): void {
  const resolved = resolveCli(session.cliId);
  if (!resolved) {
    session.status = "error";
    session.error = `CLI '${session.cliId}' not found on this machine.`;
    writeSession(session);
    return;
  }
  const { spec, binPath } = resolved;

  session.status = "thinking";
  session.startedAt = Date.now();
  session.current = null;
  session.error = null;
  writeSession(session);

  const prompt = buildCoverPrompt(session);
  const isClaude = session.cliId === "claude";
  // Cover needs research (WebSearch/Fetch) AND the final PDF render (Write +
  // Bash: writes the payload to /tmp, runs generate-cover-letter.mjs). Task /
  // NotebookEdit stay blocked. Never submits — a prompt-level guarantee.
  const args = isClaude
    ? [
        "-p",
        prompt,
        "--permission-mode",
        "acceptEdits",
        "--allowedTools",
        "Read,WebFetch,WebSearch,Write,Edit,Bash,Glob,Grep",
        "--disallowedTools",
        "Task,NotebookEdit",
      ]
    : spec.args(prompt);

  log(session.id, `spawn turn (${session.transcript.length} prior) cli=${session.cliId} bin=${binPath}`);
  const child = spawn(binPath, args, { cwd: careerOpsRoot(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  INFLIGHT.add(child);
  let buf = "";
  let stderrTail = "";

  const killer = setTimeout(() => {
    log(session.id, "TIMEOUT → SIGTERM");
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }, TURN_KILL_MS);

  child.stdout.on("data", (d: Buffer) => {
    buf += d.toString();
  });
  child.stderr.on("data", (d: Buffer) => {
    stderrTail = (stderrTail + d.toString()).slice(-400);
  });

  const finish = (code: number | null, signal: NodeJS.Signals | null) => {
    clearTimeout(killer);
    INFLIGHT.delete(child);
    // Re-read from disk: the child ran detached, and a newer turn/reset could
    // have superseded this session while it worked. Only commit if this is still
    // the in-flight turn (same startedAt).
    const fresh = readSession(session.id);
    if (!fresh || fresh.startedAt !== session.startedAt || fresh.status !== "thinking") {
      log(session.id, "superseded — dropping result");
      return;
    }
    log(session.id, `exit code=${code} signal=${signal} · ${buf.length} chars`);
    finalizeTurn(fresh, buf, stderrTail);
  };
  child.on("close", finish);
  child.on("error", (e) => {
    log(session.id, `spawn error: ${e.message}`);
    finish(null, null);
  });
}

/** Parse the CLI's buffered output into an envelope and commit it to the session. */
function finalizeTurn(session: CoverSession, out: string, stderrTail: string): void {
  const { obj } = extractJsonObject(out);
  const envelope: CoverEnvelope | null = obj ? coerceEnvelope(obj) : null;
  if (!envelope) {
    session.status = "error";
    session.error = out.trim()
      ? "Couldn't read the assistant's response for this step. Retry to continue."
      : stderrTail.trim()
        ? `The assistant errored: ${stderrTail.trim().slice(0, 160)}`
        : "The assistant produced no output — is your CLI installed and authenticated?";
    writeSession(session);
    log(session.id, `parse failed: ${session.error}`);
    return;
  }

  session.transcript.push({ role: "agent", envelope });

  if (envelope.phase === "collect") {
    session.current = envelope;
    session.status = "awaiting-input";
  } else if (envelope.phase === "review") {
    session.current = envelope;
    session.status = "review";
  } else {
    // done — verify the PDF actually landed before claiming it (honesty gate).
    let pdfPath = envelope.pdfPath;
    let note = envelope.note;
    if (pdfPath) {
      const abs = path.join(careerOpsRoot(), pdfPath);
      if (!fs.existsSync(abs)) {
        log(session.id, `done but PDF missing: ${pdfPath}`);
        note = `${note ? note + " " : ""}(Note: the PDF file wasn't found on disk — the letter is ready, but re-run the last step if you need the PDF.)`;
        pdfPath = undefined;
      }
    }
    session.current = null;
    session.status = "done";
    session.result = { letterMarkdown: envelope.letterMarkdown, pdfPath, note };
  }
  writeSession(session);
  log(session.id, `committed phase=${envelope.phase} status=${session.status}`);
}
