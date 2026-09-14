import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveCli, defaultCliId } from "@/lib/clis";
import { careerOpsRoot, readMemory, readOpencodeModels } from "@/lib/career-ops";
import { acquireTrackerWrite, releaseTrackerWrite } from "@/lib/core/run-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800; // a real oferta evaluation / pdf-mode CV tailoring + render is heavy and multi-step

// The web ORCHESTRATES the real career-ops engine — it does NOT reimplement it.
// kind "evaluate" runs the REAL modes/oferta.md and persists the canonical
// artifacts (A–F report + tracker row) via the SAME scripts the CLI uses
// (reserve-report-num.mjs → reports/ → batch/tracker-additions/ → merge-tracker.mjs),
// so a web evaluation is byte-identical to a CLI one (single source of truth, no
// drift). kind "research" stays read-only. Streams progress as NDJSON events.
function buildPrompt(kind: string, input: string, memory: string, today: string, cwd: string): string {
  const mem = memory.trim() ? `\n\nDurable notes about the user (from their profile):\n${memory.trim()}\n` : "";
  if (kind === "research") {
    return `You are investigating the user's OWN work / portfolio to surface job-search-relevant strengths, headless. Your absolute Current Working Directory (CWD) is EXACTLY \`${cwd}\`. You MUST use this exact path for all tool calls and commands. Investigate the target (use WebFetch for URLs; read local files if referenced) and report: what it is, why it is impressive, and how to leverage it in their job search — which roles/claims it supports and how to frame it on a CV. Be specific, honest, and encouraging.${mem}

End with EXACTLY one final line: VERDICT: {0-5 signal strength}/5 — {why it helps their search, ≤12 words}

Target: ${input}`;
  }
  if (kind === "pdf") {
    return `You are generating the user's ATS-optimized, TAILORED CV for application #${input}, headless, on their machine. Your absolute Current Working Directory (CWD) is EXACTLY \`${cwd}\`. You MUST use this exact path for all tool calls and commands. Run the REAL career-ops "pdf" mode — follow modes/pdf.md EXACTLY (do not improvise a format or a different pipeline).

1. Read modes/pdf.md and follow its "Full pipeline" EXACTLY (all steps 1–18): read cv.md, config/profile.yml, and the evaluation report at reports/${input}-*.md (for the JD keywords + analysis); run the zero-LLM skill-gap check; tailor the content (NEVER invent skills — only reword REAL experience using the JD's vocabulary); build the JSON payload; run \`build-cv-html.mjs\` to produce \`output/cv-{candidate}-{company}.html\` (candidate = config/profile.yml's name in kebab-case) — this MUST land in \`output/\`, never \`/tmp\`, because that persisted HTML is what "Review tailored CV" reads back later. Do not skip the fact gate (\`verify-cv-facts.mjs\`) — if it fails, fix the HTML, don't ignore it.
2. Once that HTML exists and passes the fact gate, render the PDF: \`node generate-pdf.mjs output/cv-{candidate}-{company}.html output/cv-{candidate}-{company}-${today}.pdf --format={letter for US/Canada companies, else a4}\`.
3. Update the tracker per modes/pdf.md's "Post-generation": in data/applications.md, change the PDF column for row #${input} from ❌ to ✅.
Do not submit anything anywhere.

End with EXACTLY one final line: VERDICT: {5 if the PDF was written, else 1}/5 — {the output/ path, ≤12 words}`;
  }
  if (kind === "fix-portal") {
    return `A company's job-portal ATS slug is BROKEN — career-ops can no longer scan it, so it silently disappears from every future scan. Repair it (headless, on the user's machine). Your absolute Current Working Directory (CWD) is EXACTLY \`${cwd}\`. You MUST use this exact path for all tool calls and commands:
1. Run \`node verify-portals.mjs --add "${input}"\` — it probes Greenhouse/Ashby/Lever for the company's correct ATS slug and prints the suggested ats + slug.
2. Open portals.yml, find the "${input}" entry under tracked_companies, and update its careers_url (and any api/slug field) to the suggested WORKING ATS URL. Change ONLY this one company; preserve all other YAML structure, comments and formatting exactly.
3. Re-run \`node verify-portals.mjs\` and confirm "${input}" now shows ✅ live (not ❌).
If NO slug variant resolves, say so clearly and leave portals.yml unchanged. Never touch any other company.

End with EXACTLY one final line: VERDICT: {5 if now live, else 1}/5 — {what you changed, ≤12 words}`;
  }
  if (kind === "scan-broad") {
    return `You are running the career-ops BROAD portal search (Levels 1 + 3 of the scan mode — the coverage beyond what the zero-token \`scan.mjs\` script already does), HEADLESS, on the user's own machine. Your absolute Current Working Directory (CWD) is EXACTLY \`${cwd}\`. You MUST use this exact path for all tool calls and commands. Today is ${today}.

1. Run \`node scan.mjs\` FIRST — it covers Level 0 (local parsers) + Level 2 (direct ATS APIs) for free, and its output tells you which tracked_companies it already resolved. Do not repeat those in the steps below.

2. Read modes/scan.md and follow it for the remaining levels, with ONE change: you are headless, so Playwright/browser_navigate is UNAVAILABLE.
   - Level 1 (Playwright company browsing): SKIP it. If a tracked_companies entry has no working \`api:\` and no local parser, note it in your summary as needing a manual/interactive scan later — do not fabricate results for it.
   - Level 3 (WebSearch): run every enabled entry in portals.yml's \`search_queries\`. This works headless (WebSearch is available to you).
   - Level-3 liveness verification: modes/scan.md calls for Playwright here too — instead run \`node check-liveness.mjs <url1> <url2> ...\` (batch multiple URLs in one call where you can). It checks ATS APIs first and only launches its own headless Chromium as a last resort, so it works fine headless. Drop anything it reports expired/uncertain.

3. Filter every remaining candidate through portals.yml's \`title_filter\` and \`location_filter\`, exactly as scan.mjs does.

4. Deduplicate against data/scan-history.tsv, data/applications.md, and data/pipeline.md — never add a URL that's already in any of the three.

5. For each genuinely new offer that survives filtering + liveness + dedup:
   a. Append to data/pipeline.md's Pending section: \`- [ ] {url} | {company} | {title}\`
   b. Record a row in data/scan-history.tsv — 9 tab-separated columns per modes/scan.md's "Scan History" table (url, first_seen, portal/query name, title, company, status, location, jd_fingerprint [leave empty — no JD body available from a search snippet], postedAt [leave empty if unknown]).

6. This is discovery ONLY — never evaluate, apply to, fill a form for, or contact anyone about any posting found here.${mem}

After everything above is written, output EXACTLY one final line, nothing after it:
VERDICT: {5 if at least one new role was added, else 2}/5 — {N} new role(s) added to your inbox`;
  }
  // evaluate (default) — run the REAL oferta mode + persist canonically
  return `You are running the OFFICIAL career-ops job evaluation, HEADLESS, on the user's own machine. Your absolute Current Working Directory (CWD) is EXACTLY \`${cwd}\`. You MUST use this exact path for all tool calls and commands. Today is ${today}. Run the REAL career-ops evaluation — do NOT improvise your own scoring.

1. Read modes/oferta.md and follow it EXACTLY (blocks A–F, G posting-legitimacy, and the Machine Summary). Ground the fit in THIS person: read cv.md, config/profile.yml and modes/_profile.md. Use WebFetch to read the posting (you are headless — Playwright is unavailable, so use WebFetch and mark the report header "Verification: unconfirmed (batch mode)").

2. Persist the result CANONICALLY so the web and the CLI share ONE source of truth:
   a. Reserve a report number: run \`node reserve-report-num.mjs\` — its stdout is a 3-digit number (e.g. 035).
   b. Write the full report to reports/{num}-{company-slug}-${today}.md  (company-slug = company lowercased, non-alphanumerics → hyphens).
   c. Append ONE row of 9 TAB-separated columns to batch/tracker-additions/{num}-{company-slug}.tsv, in THIS exact order (real \\t tabs, status BEFORE score):
      {num}\t${today}\t{Company}\t{Role}\t{CanonicalStatus e.g. Evaluated}\t{score}/5\t❌\t[{num}](reports/{num}-{company-slug}-${today}.md)\t{one-line note}
   d. Merge into the tracker: run \`node merge-tracker.mjs\` (it dedupes by company+role+report-num, validates the status, and writes data/applications.md — NEVER edit applications.md by hand).
   e. Inbox cleanup: read data/pipeline.md. If there is a \`- [ ]\` row containing the URL, move it to the "Processed" section formatted exactly as: \`- [x] #{num} | ${input} | {Company} | {Role} | {score}/5 | PDF ❌\`

3. NEVER submit an application, fill no forms, contact no one. This is evaluation + persistence ONLY.${mem}

After everything above is written and merged, output EXACTLY one final line, nothing after it:
VERDICT: {score}/5 — {reason in 12 words or fewer}

Posting URL: ${input}`;
}

export async function POST(req: Request) {
  let body: { kind?: string; input?: string; cliId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "bad json" }), { status: 400 });
  }
  const { kind = "evaluate", input, cliId: requestedCliId } = body;
  if (!input) {
    return new Response(JSON.stringify({ error: "input required" }), { status: 400 });
  }
  // No explicit Config selection → server-side default (Antigravity → Claude →
  // first installed), so a fresh install works without visiting Config first.
  const cliId = requestedCliId || defaultCliId();
  if (!cliId) {
    return new Response(JSON.stringify({ error: "No AI CLI found on this machine — open Config to install one." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  const resolved = resolveCli(cliId);
  if (!resolved) {
    return new Response(JSON.stringify({ error: `CLI '${cliId}' not found` }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { spec, binPath } = resolved;

  // These run the REAL core (modes/scripts), not just data — fail clearly if the
  // root is incomplete instead of faking it.
  const needsScript: Record<string, string> = { evaluate: "modes/oferta.md", "fix-portal": "verify-portals.mjs", pdf: "generate-pdf.mjs", "scan-broad": "modes/scan.md" };
  const required = needsScript[kind];
  if (required && !fs.existsSync(path.join(careerOpsRoot(), required))) {
    return new Response(
      JSON.stringify({
        error: `This needs a complete career-ops checkout (${required}). CAREER_OPS_ROOT has data only — point it at a full checkout.`,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // An A–F score is meaningless without a CV to score against — the CLI would
  // hallucinate a fit narrative and still emit a VERDICT. Require cv.md first.
  if ((kind === "evaluate" || kind === "pdf") && !fs.existsSync(path.join(careerOpsRoot(), "cv.md"))) {
    return new Response(
      JSON.stringify({ error: "Add your CV first so I can score this against you — drop it on the home page." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const prompt = buildPrompt(kind, input, readMemory(), today, careerOpsRoot());

  const isClaude = cliId === "claude";
  // Tool scope by kind (comma-separated lists; disallowedTools is the hard
  // guardrail). 'evaluate' runs the REAL mode + persists canonical artifacts →
  // it needs Write + Bash (reserve-report-num / merge-tracker / write the
  // report). 'research' stays read-only. Task (sub-agents) is always blocked
  // (runaway cost). NEVER auto-submits — that is a prompt-level guarantee.
  const tools =
    kind === "evaluate" || kind === "fix-portal" || kind === "pdf" || kind === "scan-broad"
      ? { allowed: "Read,WebFetch,WebSearch,Write,Edit,Bash,Glob,Grep", disallowed: "Task,NotebookEdit" }
      : { allowed: "Read,WebFetch,WebSearch,Glob,Grep", disallowed: "Bash,Write,Edit,NotebookEdit,Task" };
  const args = isClaude
    ? ["-p", prompt, "--output-format", "stream-json", "--verbose", "--include-partial-messages",
       "--permission-mode", "acceptEdits",
       "--allowedTools", tools.allowed,
       "--disallowedTools", tools.disallowed]
    : spec.args(prompt);

  // OpenCode-family CLIs can front multiple models under one subscription (e.g.
  // OpenCode Go) — let config/profile.yml's optional `opencode_models` route
  // different career-ops modes to different models (a cheap agentic model for
  // scan-broad, a stronger one for evaluate/scoring). Absent that config,
  // opencode just uses whatever model it's already set to.
  if (cliId === "opencode") {
    const models = readOpencodeModels();
    const model = (kind === "scan-broad" ? models.scan : kind === "evaluate" ? models.evaluate : undefined) ?? models.default;
    // MUST land right after "run --auto", not after "-m <model> --auto" — verified
    // by hand: opencode's arg parser hangs at bootstrap (never creates a session)
    // when -m comes before --auto, and works when --auto comes first. Insert at
    // index 2 (after spec.args' ["run","--auto"]), not 1.
    if (model) args.splice(2, 0, "-m", model);
  }

  // For write-needing kinds, snapshot reports/ so we can verify the worker
  // actually persisted (non-Claude CLIs lack Write auth and silently no-op).
  const reportsDir = path.join(careerOpsRoot(), "reports");
  const countReports = () => {
    try {
      return fs.readdirSync(reportsDir).filter((f) => f.endsWith(".md")).length;
    } catch {
      return 0;
    }
  };
  const persists = kind === "evaluate";
  const reportsBefore = persists ? countReports() : 0;
  // Tracker-mutating runs hold a write token so a row delete can't race their merge
  // (tracker.mjs delete doesn't yet share a lock with merge-tracker — see run-registry).
  const writeToken = kind === "evaluate" || kind === "pdf" ? acquireTrackerWrite() : null;

  // stdin MUST be "ignore", not the "pipe" default — Node never writes to or
  // closes a piped child stdin, so it stays open forever. opencode's `run`
  // reads/waits on stdin (for piped-input support), so a "pipe" default makes
  // it hang indefinitely right after bootstrap, before even creating a
  // session — confirmed via opencode's own log (~/.local/share/opencode/log),
  // which shows the process never getting past "init". Other CLIs don't need
  // piped stdin either (they take the prompt via -p / positional arg).
  const child = spawn(binPath, args, { cwd: careerOpsRoot(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  const enc = new TextEncoder();

  // `closed` + kill timer in the OUTER scope so cancel() (client disconnect) can
  // flip `closed` before the child's late handlers run, and send() is try/catch'd —
  // otherwise a late enqueue onto a closed controller throws uncaught (see #1155).
  let closed = false;
  let killer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let buf = "";
      let emittedText = false; // any assistant text delta → the CLI actually ran
      let sawError = false;
      let lastTokens = 0; // per-run token cost from the Claude result event (#6) — local only
      let lastCostUsd: number | null = null;
      // pdf-mode tailors a full CV + renders it, scan-broad walks multiple
      // WebSearch queries + liveness checks — both need more headroom.
      const killMs = kind === "pdf" || kind === "scan-broad" ? 720_000 : 285_000;
      killer = setTimeout(() => {
        try { child.kill("SIGTERM"); } catch { /* ignore */ }
      }, killMs);
      const send = (obj: unknown) => {
        if (closed) return;
        try { controller.enqueue(enc.encode(JSON.stringify(obj) + "\n")); } catch { closed = true; }
      };
      // A real evaluation goes quiet for 60-90s+ at a time (WebSearch round-trips,
      // model "thinking" between tool calls print nothing) — long enough for a
      // mobile carrier NAT, Tailscale, or any intermediary to treat the connection
      // as idle and drop it, which surfaces client-side as a false "Connection
      // error" even though the worker is still running fine server-side. A
      // no-op ping every 15s keeps bytes flowing so nothing in the path decides
      // the connection is dead. The client already ignores unrecognized event
      // types, so no client change is needed.
      heartbeat = setInterval(() => send({ type: "ping" }), 15_000);
      const close = () => {
        if (!closed) {
          closed = true;
          if (killer) clearTimeout(killer);
          if (heartbeat) clearInterval(heartbeat);
          if (writeToken !== null) releaseTrackerWrite(writeToken);
          try { controller.close(); } catch { /* */ }
        }
      };

      child.stdout.on("data", (d: Buffer) => {
        if (closed) return;
        if (!isClaude) {
          emittedText = true;
          send({ type: "text", text: d.toString() });
          return;
        }
        buf += d.toString();
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.type === "stream_event") {
              const e = ev.event;
              if (e?.type === "content_block_start" && e.content_block?.type === "tool_use") {
                send({ type: "tool", name: e.content_block.name });
              } else if (e?.type === "content_block_delta" && e.delta?.text) {
                emittedText = true;
                send({ type: "text", text: e.delta.text });
              }
            } else if (ev.type === "system" && ev.subtype === "init") {
              send({ type: "status", label: "Agent ready" });
            } else if (ev.type === "result") {
              // Capture the per-run cost; the authoritative "done" is sent on close
              // (so the honesty gate decides done-vs-error first). Tokens = the same
              // formula /api/usage uses: input + output + cache-creation.
              const u = ev.usage || {};
              lastTokens = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
              if (typeof ev.total_cost_usd === "number") lastCostUsd = ev.total_cost_usd;
            }
          } catch {
            /* partial line */
          }
        }
      });
      child.stderr.on("data", (d: Buffer) => {
        const s = d.toString();
        // Widened: auth/login/quota failures are the most common real error and
        // the old narrow regex missed them (silent false "success").
        if (/error|denied|fatal|not found|unauthorized|forbidden|auth|login|credential|api[ -]?key|quota|rate limit|not authenticated/i.test(s)) {
          sawError = true;
          send({ type: "error", msg: s.trim().slice(0, 200) });
        } else if (!isClaude) {
          // Some CLIs (OpenCode confirmed) write their live tool-call/progress
          // narration to stderr, not stdout — without this, non-error stderr was
          // silently dropped and the user saw no live "what it's doing" output
          // (unlike Antigravity, which writes progress to stdout and was always
          // forwarded below).
          emittedText = true;
          send({ type: "text", text: s });
        }
      });
      child.on("error", (e) => { send({ type: "error", msg: e.message }); close(); });
      child.on("close", (code) => {
        const wroteReport = countReports() > reportsBefore;
        const cleanExit = code === 0; // non-zero OR null (killed/signal) = NOT clean
        // Honesty gate (#9): a green "done" with a parsed score requires a CLEAN exit,
        // real output, AND (for evaluations) a report actually written. Anything else
        // is surfaced — an errored run must never be banked as a confident score.
        if (!emittedText && !sawError && !cleanExit) {
          send({ type: "error", msg: "The CLI exited with an error — is it installed and authenticated?" });
        } else if (!emittedText && !sawError) {
          send({ type: "error", msg: "The CLI produced no output — is it installed and authenticated? (career-ops is best on Claude Code.)" });
        } else if (persists && !wroteReport) {
          // The worker ran but never wrote the report/tracker row (e.g. a CLI
          // without file-write authorization) — surface it instead of a fake score.
          send({ type: "error", msg: "This evaluation didn't save a report, so it's not in your tracker. Full evaluation is verified on Claude Code." });
        } else if (persists && wroteReport) {
          // A written report is the strongest possible evidence the real
          // modes/oferta.md pipeline actually completed — `sawError` is only a
          // blunt stderr keyword match (e.g. "not found") and false-positives on
          // ordinary, expected tool noise (a Read on an optional file like
          // article-digest.md that doesn't exist). Don't let that flip a
          // genuinely finished, persisted evaluation to "failed, re-run it".
          send({ type: "done", tokens: lastTokens, costUsd: lastCostUsd });
        } else if (!cleanExit || sawError) {
          // Produced output (maybe even a report) but did NOT finish cleanly — flag it
          // instead of recording a confident score off a half-finished run.
          send({ type: "error", msg: "This run hit an error before finishing, so it isn't recorded as a confident result — re-run it to verify." });
        } else {
          send({ type: "done", tokens: lastTokens, costUsd: lastCostUsd });
        }
        close();
      });
    },
    cancel() {
      closed = true;
      if (killer) clearTimeout(killer);
      if (heartbeat) clearInterval(heartbeat);
      if (writeToken !== null) releaseTrackerWrite(writeToken);
      // Do NOT kill the child process if the user navigates away or reloads.
      // Let the evaluation finish in the background and write its report + tracker edits.
      // try { child.kill("SIGTERM"); } catch { /* ignore */ }
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
