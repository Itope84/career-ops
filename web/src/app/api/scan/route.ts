import { spawn } from "node:child_process";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { registerJob, updateJob } from "@/lib/core/run-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600; // 45+ portal APIs, sequential per provider

// Runs the REAL core portal scan (`node scan.mjs`, no flags) — the same
// profile-driven scan the CLI runs: portals.yml companies + config/profile.yml
// filters, appending new matches to data/pipeline.md (the inbox). Zero LLM
// tokens — pure HTTP + JSON — so no CLI resolution or cost gate is needed.
// Streams progress as NDJSON: {type:"line"} per stdout line, then one
// {type:"done", added, companies} | {type:"error", msg}.

// Single-flight: scan.mjs appends to pipeline.md / scan-history.tsv; two
// concurrent scans would double-append. Module scope survives across requests
// in the one long-lived Next server process (local-first, single instance).
let scanning = false;

const ADDED_RE = /New offers added:\s+(\d+)/;
const COMPANIES_RE = /Companies scanned:\s+(\d+)/;

export async function POST(req: Request) {
  // Body is optional (existing callers with no body still work) — id lets the
  // client reconcile this run against the durable registry by the SAME id it
  // shows locally, same convention as /api/run.
  let body: { id?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* no body sent — fine, we generate our own id below */
  }
  if (!fs.existsSync(rootScript("scan"))) {
    return new Response(
      JSON.stringify({ error: "This needs a complete career-ops checkout (scan.mjs). CAREER_OPS_ROOT has data only." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  if (!fs.existsSync(`${careerOpsRoot()}/portals.yml`)) {
    return new Response(
      JSON.stringify({ error: "No portals.yml yet — set up the companies to scan on the Portals page first." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  if (scanning) {
    return new Response(JSON.stringify({ error: "A scan is already running." }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
  }
  scanning = true;

  const child = spawn(process.execPath, [rootScript("scan")], { cwd: careerOpsRoot(), env: process.env });
  const enc = new TextEncoder();

  const jobId = typeof body.id === "string" && body.id.trim() ? body.id.trim() : randomUUID();
  registerJob({ id: jobId, kind: "scan", title: "AI Search", input: "portals.yml" });

  let closed = false;
  let finished = false; // guards the registry write specifically — see /api/run's same pattern
  let killer: ReturnType<typeof setTimeout> | undefined;
  let killedByTimeout = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let outBuf = "";
      let added: number | null = null;
      let companies: number | null = null;
      let errTail = "";
      killer = setTimeout(() => {
        killedByTimeout = true;
        try { child.kill("SIGTERM"); } catch { /* ignore */ }
      }, 300_000);
      const send = (obj: unknown) => {
        if (closed) return;
        try { controller.enqueue(enc.encode(JSON.stringify(obj) + "\n")); } catch { closed = true; }
      };
      const finishDone = (addedN: number, companiesN: number | null) => {
        if (finished) return;
        finished = true;
        send({ type: "done", added: addedN, companies: companiesN });
        updateJob(jobId, { status: "done", endedAt: Date.now(), subtitle: `${addedN} new${companiesN != null ? ` · ${companiesN} companies` : ""}` });
      };
      const finishError = (msg: string) => {
        if (finished) return;
        finished = true;
        send({ type: "error", msg });
        updateJob(jobId, {
          status: killedByTimeout ? "timeout" : "error",
          endedAt: Date.now(),
          error: killedByTimeout ? "Timed out after 300s — the scan didn't finish in time." : msg,
        });
      };
      const close = () => {
        if (!closed) {
          closed = true;
          if (killer) clearTimeout(killer);
          try { controller.close(); } catch { /* */ }
        }
        scanning = false;
      };

      child.stdout.on("data", (d: Buffer) => {
        outBuf += d.toString();
        let nl: number;
        while ((nl = outBuf.indexOf("\n")) !== -1) {
          const line = outBuf.slice(0, nl).trimEnd();
          outBuf = outBuf.slice(nl + 1);
          if (!line.trim()) continue;
          const a = line.match(ADDED_RE);
          if (a) added = parseInt(a[1], 10);
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
        if (code === 0 && added != null) {
          finishDone(added, companies);
        } else if (code === 0) {
          // Ran clean but the summary line never appeared — surface it honestly
          // instead of claiming "0 new" off an unparsed run.
          finishError("Scan finished but the summary couldn't be read — check the terminal output.");
        } else {
          finishError(errTail.trim().slice(0, 300) || `scan.mjs exited with code ${code}`);
        }
        close();
      });
    },
    cancel() {
      closed = true;
      // Let the scan finish and write its results even if the tab closed —
      // matches /api/run's behavior for evaluations. The kill timer and the
      // `scanning` flag stay armed until the child actually exits (its close
      // handler releases them), so a reload can't start a second concurrent scan.
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
