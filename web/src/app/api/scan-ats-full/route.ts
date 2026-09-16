import { spawn } from "node:child_process";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { registerJob, updateJob } from "@/lib/core/run-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 2400; // walks tens of thousands of boards — see KILL_MS

// Runs the REVERSE ATS scan (`node scan-ats-full.mjs`). Where /api/scan asks
// "what do MY tracked companies have?", this inverts it: it walks the public
// per-ATS company directories (Greenhouse 8.3k, Lever 4.4k, Ashby 3.2k,
// Workday 12.9k) and surfaces fresh postings matching portals.yml's
// title_filter/location_filter — no company curation at all.
//
// Zero LLM tokens, like /api/scan: pure HTTP + JSON through the same providers/
// modules. So no CLI resolution and no cost gate.
//
// It gets its OWN endpoint and job kind rather than sharing /api/scan because
// it runs roughly two orders of magnitude longer (measured: ~0.04s/company
// parallelised, so ~10 min for the three smaller directories and ~18 min with
// Workday, against ~5s for a normal scan). Sharing one button would have meant
// one "scanning…" state covering wildly different waits.
//
// Streams NDJSON: {type:"line"} per stdout line, then
// {type:"done", matches, companies} | {type:"error", msg}.

// Single-flight, same reasoning as /api/scan: this appends to pipeline.md and
// scan-history.tsv, so two concurrent runs would double-append. Separate flag
// from /api/scan's — the two touch the same files, but serialising them against
// each other would mean a 20-minute reverse scan blocks the 5-second one. They
// each append under scan.mjs's own file handling, as they already did when run
// from the CLI.
let running = false;

// Bounded well above the ~18 min full-sweep measurement, so a slow network
// doesn't kill a legitimate run, but a wedged child still cannot hang forever.
const KILL_MS = 35 * 60 * 1000;

const MATCHES_RE = /New matches:\s+(\d+)/;
const COMPANIES_RE = /Companies scanned:\s+(\d+)/;

export async function POST(req: Request) {
  let body: { id?: string; ats?: string; sinceDays?: number; limit?: number } = {};
  try {
    body = await req.json();
  } catch {
    /* no body — defaults below */
  }

  if (!fs.existsSync(rootScript("scan-ats-full"))) {
    return new Response(
      JSON.stringify({ error: "This needs a complete career-ops checkout (scan-ats-full.mjs)." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  if (!fs.existsSync(`${careerOpsRoot()}/portals.yml`)) {
    return new Response(
      JSON.stringify({ error: "No portals.yml yet — the reverse scan needs its title_filter/location_filter to match against." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  if (running) {
    return new Response(JSON.stringify({ error: "A full ATS scan is already running." }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
  }
  running = true;

  // Only flags we build ourselves are ever passed to the child — the request
  // body picks VALUES, never raw argv, so a crafted body can't inject options.
  const argv = [rootScript("scan-ats-full")];
  if (typeof body.sinceDays === "number" && Number.isFinite(body.sinceDays) && body.sinceDays > 0) {
    argv.push("--since", String(Math.floor(body.sinceDays)));
  }
  if (typeof body.limit === "number" && Number.isFinite(body.limit) && body.limit > 0) {
    argv.push("--limit", String(Math.floor(body.limit)));
  }
  if (typeof body.ats === "string" && /^[a-z0-9,]+$/i.test(body.ats)) {
    argv.push("--ats", body.ats.toLowerCase());
  }

  const child = spawn(process.execPath, argv, { cwd: careerOpsRoot(), env: process.env });
  const enc = new TextEncoder();

  const jobId = typeof body.id === "string" && body.id.trim() ? body.id.trim() : randomUUID();
  registerJob({ id: jobId, kind: "scan-ats-full", title: "Scan ATS Full", input: "ats-directories" });

  let closed = false;
  let finished = false;
  let killer: ReturnType<typeof setTimeout> | undefined;
  let killedByTimeout = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let outBuf = "";
      let matches: number | null = null;
      let companies: number | null = null;
      let errTail = "";

      killer = setTimeout(() => {
        killedByTimeout = true;
        try { child.kill("SIGTERM"); } catch { /* ignore */ }
      }, KILL_MS);

      const send = (obj: unknown) => {
        if (closed) return;
        try { controller.enqueue(enc.encode(JSON.stringify(obj) + "\n")); } catch { closed = true; }
      };
      const finishDone = (matchesN: number, companiesN: number | null) => {
        if (finished) return;
        finished = true;
        send({ type: "done", matches: matchesN, companies: companiesN });
        updateJob(jobId, {
          status: "done",
          endedAt: Date.now(),
          subtitle: `${matchesN} new${companiesN != null ? ` · ${companiesN} boards` : ""}`,
        });
      };
      const finishError = (msg: string) => {
        if (finished) return;
        finished = true;
        send({ type: "error", msg });
        updateJob(jobId, {
          status: killedByTimeout ? "timeout" : "error",
          endedAt: Date.now(),
          error: killedByTimeout
            ? `Timed out after ${Math.round(KILL_MS / 60000)} min — the reverse scan didn't finish in time.`
            : msg,
        });
      };
      const close = () => {
        if (!closed) {
          closed = true;
          if (killer) clearTimeout(killer);
          try { controller.close(); } catch { /* */ }
        }
        running = false;
      };

      child.stdout.on("data", (d: Buffer) => {
        outBuf += d.toString();
        let nl: number;
        while ((nl = outBuf.indexOf("\n")) !== -1) {
          const line = outBuf.slice(0, nl).trimEnd();
          outBuf = outBuf.slice(nl + 1);
          if (!line.trim()) continue;
          const m = line.match(MATCHES_RE);
          if (m) matches = parseInt(m[1], 10);
          const c = line.match(COMPANIES_RE);
          if (c) companies = parseInt(c[1], 10);
          send({ type: "line", text: line });
        }
      });
      child.stderr.on("data", (d: Buffer) => {
        errTail = (errTail + d.toString()).slice(-500);
      });
      child.on("error", (e) => {
        finishError(e.message);
        close();
      });
      child.on("close", (code) => {
        if (code === 0 && matches != null) {
          finishDone(matches, companies);
        } else if (code === 0) {
          finishError("Reverse scan finished but the summary couldn't be read — check the terminal output.");
        } else {
          finishError(errTail.trim().slice(0, 300) || `scan-ats-full.mjs exited with code ${code}`);
        }
        close();
      });
    },
    cancel() {
      closed = true;
      // Deliberately do NOT kill the child: this run is 10-20 minutes and
      // closing the tab must not throw that away. The registry entry is what
      // the UI re-adopts on the next page load, and the kill timer plus the
      // single-flight flag stay armed until the child actually exits.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
