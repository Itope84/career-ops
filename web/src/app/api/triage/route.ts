import { NextResponse } from "next/server";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolveCli } from "@/lib/clis";
import { careerOpsRoot, rootScript, readOpencodeModels } from "@/lib/career-ops";
import { registerJob, updateJob } from "@/lib/core/run-registry";

/**
 * Run opencode and resolve the moment a complete JSON array appears on
 * stdout — deliberately NOT waiting for the process to exit.
 *
 * WHY: `opencode run` boots a file watcher and an event stream for the
 * session, and after it has finished answering it frequently never exits.
 * Confirmed from its own logs: a 5-posting batch went
 * `created 21:20:06.036 → disposing instance 21:20:12.308` — the full,
 * correct JSON answer was on stdout in 6.3s — yet the process stayed alive.
 * The previous implementation used execFile, which waits for EXIT, so it sat
 * there until the timeout, killed the child, and threw away an answer it
 * already had. That is exactly why a real run reported "0 flagged of 20"
 * after burning exactly 60.129s: every chunk "timed out" and fell through to
 * the keep-everything fail-safe, without the model's verdicts ever being read.
 */
function runOpencode(binPath: string, args: string[], cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binPath, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let settled = false;
    const finish = (ok: boolean, value: string | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
      if (ok) resolve(value as string);
      else reject(value as Error);
    };
    const timer = setTimeout(() => {
      // Last chance: it may well have answered and simply not exited.
      if (extractJsonArray(out)) finish(true, out);
      else finish(false, new Error(`opencode timed out after ${timeoutMs}ms${err.trim() ? ` — ${err.trim().slice(0, 200)}` : ""}`));
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
      if (extractJsonArray(out)) finish(true, out);
    });
    child.stderr.on("data", (d: Buffer) => {
      err = (err + d.toString()).slice(-2000);
    });
    child.on("error", (e) => finish(false, e));
    child.on("close", () => {
      if (extractJsonArray(out)) finish(true, out);
      else finish(false, new Error(err.trim().slice(0, 300) || "opencode produced no parseable output"));
    });
  });
}

// Quick Triage — a fast, cheap first pass over the inbox using only
// title/company/location (no JD fetch, no tracker write). Rewritten from the
// original per-job Cloudflare Workers AI implementation, which had two real
// problems: (1) it hand-appended a row straight into data/applications.md,
// bypassing merge-tracker's lock/atomic-write/validation entirely, and (2) it
// made one model call PER job — 137 round trips, each re-paying the full
// deal-breaker preamble. This version makes one batched call per chunk of
// jobs via OpenCode (matching this project's headless-worker convention —
// see AGENTS.md's "Headless / Batch Mode" table), and never touches the
// tracker at all: a discard here just means "don't ask a real evaluation to
// look at this" — see /api/pipeline/archive for the (separate, explicit)
// step that actually removes it from the inbox.
//
// POST body: { items: [{ id, company, role, location }] }
// Response:  { results: [{ id, decision: "keep"|"discard", reason? }] }
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CHUNK_SIZE = 25;
const TIMEOUT_MS = 60_000;

type Item = { id: string; company?: string; role?: string; location?: string };
type Decision = { id: string; decision: "keep" | "discard"; reason?: string };

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Pull the first balanced top-level JSON array out of a model's text answer,
 *  tolerating code fences and stray prose before/after — same spirit as
 *  extract-json.ts's object version, just for an array and without that
 *  file's truncation-salvage machinery (this array is short; not worth it). */
function extractJsonArray(text: string): unknown[] | null {
  const s = text.replace(/```(?:json)?/gi, "");
  const start = s.indexOf("[");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(s.slice(start, i + 1));
          return Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

async function triageChunk(items: Item[], binPath: string, root: string): Promise<Decision[]> {
  // Fast, bounded, local (pure JS profile parsing) — fine to run
  // synchronously, unlike the opencode call below which can take real time.
  const prompt = execFileSync(process.execPath, [rootScript("generate-triage-prompt"), "--batch"], {
    cwd: root,
    input: JSON.stringify(items),
    maxBuffer: 4 * 1024 * 1024,
    encoding: "utf8",
  });

  // Triage gets its OWN model slot (`opencode_models.triage`), deliberately
  // not reusing `scan`'s — under OpenCode Go each model draws down a
  // SEPARATE, independent monthly dollar cap (confirmed against the official
  // docs, not just per-token price), so giving triage — the highest-volume
  // of the three actions — its own bucket means it never competes with scan
  // or evaluate for the same allowance. Falls back to the account's own
  // default model when config/profile.yml has no opencode_models block
  // (fresh checkout, or a non-OpenCode-Go plan where this doesn't matter).
  const models = readOpencodeModels();
  const model = models.triage ?? models.default;
  // `--pure` skips external plugins: triage is pure text-in/JSON-out and
  // needs no tooling, so there's nothing for them to contribute. No `--auto`
  // either — that flag only exists to auto-approve TOOL permissions, and this
  // task writes nothing, so it was pure overhead.
  const args = ["run", "--pure", ...(model ? ["-m", model] : []), prompt];

  const stdout = await runOpencode(binPath, args, root, TIMEOUT_MS);

  const parsed = extractJsonArray(stdout);
  if (!parsed) throw new Error("OpenCode's response didn't contain a parseable JSON array");

  const validIds = new Set(items.map((it) => it.id));
  const out: Decision[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "string" || !validIds.has(r.id)) continue; // never trust an id the model invented
    const decision = r.decision === "discard" ? "discard" : "keep"; // unrecognized/missing → keep, never silently discard
    out.push({ id: r.id, decision, reason: typeof r.reason === "string" ? r.reason.slice(0, 200) : undefined });
  }
  // Any item the model dropped or mangled defaults to "keep" — a missed
  // discard costs one wasted full evaluation later; a wrongly discarded
  // job is a role the candidate never sees at all. Fail safe, not silent.
  const seen = new Set(out.map((d) => d.id));
  for (const it of items) {
    if (!seen.has(it.id)) out.push({ id: it.id, decision: "keep" });
  }
  return out;
}

export async function POST(req: Request) {
  let body: { items?: Item[]; id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const items = Array.isArray(body.items) ? body.items.filter((it) => it && typeof it.id === "string") : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "items required" }, { status: 400 });
  }
  // Same convention as /api/run and /api/scan: the client generates this so
  // it can reconcile against the durable registry later. A batch here is a
  // single blocking request (no SSE stream) — if the tab navigates away
  // mid-request, the fetch promise is abandoned client-side, but this handler
  // keeps running server-side and needs somewhere durable to land its result.
  const jobId = typeof body.id === "string" && body.id.trim() ? body.id.trim() : randomUUID();

  const resolved = resolveCli("opencode");
  if (!resolved) {
    return NextResponse.json(
      { error: "Quick Triage needs OpenCode installed (opencode.ai) — it's not the same engine as your Config selection, on purpose: this is a cheap, fast classification pass, not a full evaluation." },
      { status: 404 },
    );
  }
  const root = careerOpsRoot();

  registerJob({ id: jobId, kind: "triage", title: "Quick Triage", input: `${items.length} job(s)` });

  const results: Decision[] = [];
  const errors: string[] = [];
  for (const c of chunk(items, CHUNK_SIZE)) {
    try {
      results.push(...(await triageChunk(c, resolved.binPath, root)));
    } catch (err) {
      // One bad chunk (a timeout, a malformed response) doesn't fail the
      // whole batch — its jobs default to "keep" (see the same fail-safe
      // reasoning above) and the error is surfaced, not swallowed.
      errors.push(err instanceof Error ? err.message : String(err));
      for (const it of c) results.push({ id: it.id, decision: "keep" });
    }
  }

  // A "keep" is not a no-op — it MOVES the role out of the inbox and into the
  // shortlist. Triage exists to make the pile smaller in both directions; a
  // run where everything passes should still empty the inbox, not report
  // "nothing flagged" and leave all 137 rows exactly where they were.
  //
  // Done here, server-side, rather than in the browser: it then happens
  // exactly once, atomically with the run, and survives the tab being closed
  // mid-triage — the same reason the registry write below lives here.
  const byId = new Map(items.map((it) => [it.id, it]));
  const keeps = results
    .filter((r) => r.decision === "keep")
    .map((r) => byId.get(r.id))
    .filter((it): it is Item => !!it)
    .map((it) => ({ url: it.id, company: it.company || "?", role: it.role || "?" }));

  let movedToShortlist = 0;
  if (keeps.length > 0) {
    try {
      const out = execFileSync(process.execPath, [rootScript("shortlist-entries")], {
        cwd: root,
        input: JSON.stringify({ op: "add", items: keeps }),
        maxBuffer: 4 * 1024 * 1024,
        encoding: "utf8",
      });
      movedToShortlist = (JSON.parse(out).moved ?? []).length;
    } catch (err) {
      // The classification still stands and the discard review below is still
      // worth showing — surface the move failure instead of silently dropping it.
      errors.push(`Classified fine, but moving the kept roles to your shortlist failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const discardCount = results.filter((r) => r.decision === "discard").length;
  updateJob(jobId, {
    status: "done",
    endedAt: Date.now(),
    subtitle: `${movedToShortlist} shortlisted · ${discardCount} flagged`,
    data: results,
  });

  return NextResponse.json({
    id: jobId,
    results,
    movedToShortlist,
    flagged: discardCount,
    ...(errors.length ? { warnings: errors } : {}),
  });
}
