import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveCli, defaultCliId } from "@/lib/clis";
import { careerOpsRoot, readMemory, readOpencodeModels, jdCachePathFor, rootScript } from "@/lib/career-ops";
import { acquireTrackerWrite, releaseTrackerWrite, registerJob, updateJob } from "@/lib/core/run-registry";
import { acquireSlot, releaseSlot } from "@/lib/core/job-queue";
import { findOpencodeSessionId } from "@/lib/core/opencode-transcript";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800; // a real oferta evaluation / pdf-mode CV tailoring + render is heavy and multi-step

// The web ORCHESTRATES the real career-ops engine — it does NOT reimplement it.
// kind "evaluate" runs the REAL modes/oferta.md and persists the canonical
// artifacts (A–F report + tracker row) via the SAME scripts the CLI uses
// (reserve-report-num.mjs → reports/ → batch/tracker-additions/ → merge-tracker.mjs),
// so a web evaluation is byte-identical to a CLI one (single source of truth, no
// drift). kind "research" stays read-only. Streams progress as NDJSON events.
/**
 * How the evaluator should obtain the job description.
 *
 * When scan cached a rendered copy, point at the FILE. That is not just a
 * speed-up — it is a correctness fix. The worker is headless with no browser,
 * so its only alternative is a plain HTTP fetch, and on a JS-rendered board
 * that returns a shell plus whatever made it into the page's JSON-LD. A real
 * case: a Workday posting listing United Kingdom / Ireland / Spain carries
 * ONLY the UK location in its structured data, so the evaluator read
 * "UK, remote-first", correctly applied the candidate's no-remote and
 * UK-sponsorship rules, and scored it 2.0/5 — for a role openly open to
 * Ireland. The cached copy is the fully hydrated page, so those locations are
 * all present. Falls back to the old WebFetch wording when nothing is cached.
 */
/**
 * Take a role OUT of the shortlist the moment its evaluation genuinely
 * finishes — server-side, unconditionally, the instant `findOwnReport()`
 * confirms a report carrying THIS job's own URL exists. Deliberately NOT
 * left to the browser.
 *
 * Before this, removal only happened via a client event (`co-job-done`) fired
 * from an open tab that happened to be watching when the job transitioned.
 * Adoption only looks back 10 minutes and the client's in-memory job list is
 * bounded, so anything that finished while no tab was open, or finished more
 * than ~10 minutes before a tab reconnected, just stayed in the shortlist
 * forever with no further signal that it had in fact been scored — 8 roles
 * did exactly this in one night. This runs from the same process that just
 * confirmed the report was written, so there is no window for it to miss.
 *
 * The identity check in `findOwnReport()` is what makes it safe to call this
 * unconditionally: an earlier version proved a report existed with a bare
 * directory-wide file count, which any concurrently-running sibling job
 * could satisfy just by reserving a report NUMBER (an empty placeholder file)
 * — three roles fired together via "Score selected" were all marked done and
 * deleted from the shortlist that way, only one of them having done any real
 * work. Removal now only ever fires for the job whose own posting URL is
 * actually in the new report's header.
 *
 * Best-effort and silent on failure: a shortlist that's briefly one entry
 * behind is a UI nuisance; throwing here would take down an otherwise
 * successful, already-persisted evaluation over a bookkeeping step.
 */
/**
 * Finish the persistence the worker started but may not have completed.
 *
 * modes/oferta.md's sequence is: reserve a number → write the report → stage a
 * tracker TSV → merge it → clean the inbox. A worker dying between "write the
 * report" and "merge it" is the single most common failure here — `opencode
 * run` stalls mid-step routinely — and it produces the worst possible state: a
 * complete, correct report that is invisible everywhere, because the job gets
 * marked done and dropped from the shortlist on the strength of the report
 * alone. Eleven reports were recovered by hand this way in one sitting.
 *
 * reconcile-report.mjs closes that gap deterministically: already tracked →
 * no-op, TSV already staged → merge it, neither → synthesize the row from the
 * report's own Machine Summary and merge. It never invents a field, and it is
 * idempotent, so calling it on every finished evaluation is safe.
 *
 * Returns false when the report could NOT be got into the tracker — the caller
 * then surfaces the run as incomplete and LEAVES IT IN THE SHORTLIST, rather
 * than quietly dropping a role that shows up nowhere.
 */
function reconcileReportIntoTracker(reportFile: string, root: string): boolean {
  try {
    const out = execFileSync(process.execPath, [rootScript("reconcile-report"), "--report", reportFile], {
      cwd: root,
      encoding: "utf8",
      timeout: 90_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return JSON.parse(out.trim()).ok === true;
  } catch {
    return false; // non-zero exit, timeout, or unparseable output — treat as not tracked
  }
}

function removeFromShortlistOnScore(url: string, root: string): void {
  try {
    execFileSync(process.execPath, [rootScript("shortlist-entries")], {
      cwd: root,
      input: JSON.stringify({ op: "remove", url }),
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
    });
  } catch {
    /* not in the shortlist, or pipeline.md briefly locked by something else — fine either way */
  }
}

function jdClause(url: string): string {
  const cached = jdCachePathFor(url);
  return cached
    ? `Read the job description from \`${cached}\` — it is the FULL rendered page text, captured from a real browser at scan time, and is more complete than anything you can fetch headlessly (JS-rendered boards hide locations and requirements from plain HTTP fetches). Treat it as the posting. Mark the report header "Verification: cached render (scan time)". Only use WebFetch if that file is missing or obviously truncated.`
    : `Use WebFetch to read the posting (you are headless — Playwright is unavailable, so use WebFetch and mark the report header "Verification: unconfirmed (batch mode)").`;
}

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
    return `You are running the career-ops BROAD portal search (Levels 1 + 3 of the scan mode — the coverage beyond what the zero-token \`scan.mjs\` script already does), HEADLESS and unattended, on the user's own machine. Headless does NOT mean blind: you have a real browser via the \`playwright_browser_*\` tools, plus helper scripts that drive their own Chromium. Unattended DOES mean nobody can approve anything for you — so read-only actions only, and never anything that submits, sends, signs in, buys, or agrees. Your absolute Current Working Directory (CWD) is EXACTLY \`${cwd}\`. You MUST use this exact path for all tool calls and commands. Today is ${today}.

1. Run \`node scan.mjs\` FIRST — it covers Level 0 (local parsers) + Level 2 (direct ATS APIs) for free. Nearly every tracked company resolves to a zero-token provider here, INCLUDING ones with no \`api:\` field in portals.yml (providers auto-detect from \`careers_url\`). So never infer the remaining work from portals.yml — read it off scan.mjs's own output, which ends with a line reading either:
   - \`Agent/WebSearch handoff: none — every tracked company resolved to a zero-token provider\` → there is NO Level 1 or per-company work left. Go straight to Level 3.
   - \`Agent/WebSearch handoff: N compan(y|ies) …\` followed by one \`• Company (method) — hint\` bullet per company. \`(browse)\` = Level 1, \`(websearch)\` = Level 3. Those bullets are the COMPLETE list; a company not listed there is already done and must NOT be re-scanned.

2. Read modes/scan.md and follow it for the remaining levels. You DO have a real browser here: the \`playwright_browser_*\` tools (navigate, snapshot, click, type, select_option, find) drive a headless Chromium. Wherever modes/scan.md says \`browser_navigate\`/\`browser_snapshot\`, use the \`playwright_browser_\` equivalent. Where it calls for Playwright to VERIFY a posting, use \`check-liveness.mjs\` instead (below) — that is far cheaper than a snapshot per URL.
   - Level 1 (company browsing): ONLY for companies scan.mjs listed as \`(browse)\` in step 1. If it said \`handoff: none\`, SKIP Level 1 entirely — browsing a company that already resolved is pure duplicated work. Browse at most 8 companies in one run; if there are more, do the first 8 and name the rest in your summary as deferred.
     Use the \`playwright_browser_*\` tools, and SEARCH THE BOARD rather than dumping it:
       i.   \`playwright_browser_navigate\` to the careers_url, then \`playwright_browser_snapshot\`.
       ii.  If a cookie/consent banner is present, choose the most privacy-preserving option (decline/reject non-essential). Never accept optional tracking.
       iii. CLEAR any filter the board pre-applied before you read anything — boards commonly geo-filter by server-side IP, which is NOT the user's target location and silently hides most roles.
       iv.  Then drive the board's OWN search box and location/department filters using this person's target titles and locations (read config/profile.yml and portals.yml \`title_filter\`/\`location_filter\` first). Filtering AT THE BOARD is the point: it turns a 400-row dump into the handful of rows that actually match, so do this instead of paging through everything.
       v.   Read the matching rows — title, location and posting URL — from the snapshot.
     READ-ONLY. Never click Apply, never submit, never fill a form, never sign in, never accept terms.
     Fallback ONLY if the \`playwright_browser_*\` tools are unavailable to you: run \`node browser-extract.mjs <careers_url> --mode listing\`, which prints \`{ url, jobs: [{ title, url }] }\`. Treat that output as a LOWER BOUND, never as the truth about the board — it reads \`<a href>\` links only, so boards rendering postings as JS cards return an empty or short list even when full, and it returns no location at all. If its \`jobs\` array is empty or implausibly short, report "extraction returned nothing — needs manual check", NOT "this company has no open roles". Never state a company has no vacancies on the strength of that script, and never invent postings for any company.
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

1. Read modes/oferta.md and follow it EXACTLY (blocks A–F, G posting-legitimacy, and the Machine Summary). Ground the fit in THIS person: read cv.md, config/profile.yml and modes/_profile.md. ${jdClause(input)}

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
  let body: { kind?: string; input?: string; cliId?: string; id?: string; title?: string; subtitle?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "bad json" }), { status: 400 });
  }
  const { kind = "evaluate", input, cliId: requestedCliId, title, subtitle } = body;
  // The client generates this so it can reconcile its own local job against
  // the durable registry later (reload, dropped connection, another device).
  // Falls back to a server-generated id for any caller that doesn't send one.
  const jobId = typeof body.id === "string" && body.id.trim() ? body.id.trim() : randomUUID();
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

  // For write-needing kinds, snapshot reports/ so we can verify THIS job's
  // own worker actually persisted its own report (non-Claude CLIs lack Write
  // auth and silently no-op).
  //
  // NOT a file count. A bare count — `readdirSync().length` before vs. after —
  // has no idea WHICH job caused the directory to grow, and under real
  // concurrency (several evaluations from "Score selected" running in
  // parallel through the job queue) any one of them reserving a report
  // number is enough to flip every OTHER concurrently-running job's own
  // count comparison to "wrote a report" too — including jobs that had
  // barely started. Confirmed live: three roles fired together all got
  // marked done and deleted from the shortlist within the same ~40s window,
  // while one of them (checked against its own opencode transcript) had done
  // nothing but read a few files and one webfetch — no report, no VERDICT,
  // nowhere near finished. `reserve-report-num.mjs` creates its placeholder
  // (`NNN-RESERVED.md`, zero bytes) the instant a number is claimed, long
  // before any real content exists, which is exactly what tripped the count.
  //
  // The fix: snapshot the actual FILE SET before spawning, and afterward
  // require a NEW, non-placeholder file whose own `**URL:**` header matches
  // THIS job's `input` — every report is required to carry that header (see
  // AGENTS.md), so it is the one piece of identity a report already commits
  // to. A sibling job's report existing is no longer evidence of anything.
  const reportsDir = path.join(careerOpsRoot(), "reports");
  const listReportFiles = (): Set<string> => {
    try {
      // RESERVED placeholders are real files but never real reports.
      return new Set(fs.readdirSync(reportsDir).filter((f) => f.endsWith(".md") && !f.endsWith("-RESERVED.md")));
    } catch {
      return new Set();
    }
  };
  const persists = kind === "evaluate";
  const reportsBefore = persists ? listReportFiles() : new Set<string>();
  /** The exact new report this job's own run produced, or null. Checked once,
   *  after the child closes — see its call site for why a null here means
   *  "surface as an error", never "treat as done anyway". */
  const findOwnReport = (): string | null => {
    if (!persists) return null;
    for (const f of listReportFiles()) {
      if (reportsBefore.has(f)) continue; // pre-existing — not from this run
      try {
        const content = fs.readFileSync(path.join(reportsDir, f), "utf8");
        const m = content.match(/\*\*URL:\*\*\s*(\S+)/);
        if (m && m[1].trim() === input.trim()) return f;
      } catch {
        /* unreadable (mid-write?) — not proof of anything, keep looking */
      }
    }
    return null;
  };
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
  // NOT spawned yet — the process is the expensive, machine-killing resource,
  // so it is created only once job-queue.ts hands out a slot (see below).
  let child: ReturnType<typeof spawn> | null = null;
  const enc = new TextEncoder();

  // Durable record from the moment the request is ACCEPTED — independent of
  // whether this HTTP connection stays open, and now also independent of
  // whether a worker slot is free yet. See run-registry.ts's header.
  registerJob({
    id: jobId,
    kind: kind as "evaluate" | "pdf" | "research" | "fix-portal" | "scan-broad",
    title: title || `${kind} · ${input}`,
    subtitle,
    input,
    status: "queued",
  });

  // `closed` + kill timer in the OUTER scope so cancel() (client disconnect) can
  // flip `closed` before the child's late handlers run, and send() is try/catch'd —
  // otherwise a late enqueue onto a closed controller throws uncaught (see #1155).
  let closed = false;
  let killer: ReturnType<typeof setTimeout> | undefined;
  let reaper: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buf = "";
      let emittedText = false; // any assistant text delta → the CLI actually ran
      let sawError = false;
      let lastTokens = 0; // per-run token cost from the Claude result event (#6) — local only
      let lastCostUsd: number | null = null;
      // Bounded tail of everything the CLI has printed — kept ONLY so a
      // VERDICT line can be recovered for the registry even when nobody's
      // connection is open to read the live stream. Same idea as the
      // client's own 8000-char rolling tail, just server-side.
      let textTail = "";
      let killedByTimeout = false;
      // Distinct from `closed` (which only means "stop writing to the SSE
      // stream", and gets set on a client disconnect via cancel() — long
      // before the child itself has actually exited). This one guards the
      // registry write specifically, so a disconnect can never suppress it.
      let finished = false;
      // pdf-mode tailors a full CV + renders it, scan-broad walks multiple
      // WebSearch queries + liveness checks — both need more headroom.
      const killMs = kind === "pdf" || kind === "scan-broad" ? 720_000 : 285_000;
      const send = (obj: unknown) => {
        if (closed) return;
        try { controller.enqueue(enc.encode(JSON.stringify(obj) + "\n")); } catch { closed = true; }
      };

      // ── Concurrency gate ────────────────────────────────────────────────
      // Wait here, NOT in the browser. "Score all" fires one request per role;
      // without this, 99 roles meant 99 concurrent agent processes, which
      // exhausted RAM and took every career-ops instance on this machine down
      // with it. Waiting costs one idle socket; the job is already durable in
      // the registry, and this handler keeps running after the client goes
      // away, so a queued job still starts even if the tab was closed.
      let slotHeld = false;
      send({ type: "status", label: "Queued — waiting for a worker slot" });
      await acquireSlot();
      slotHeld = true;
      try {
        child = spawn(binPath, args, { cwd: careerOpsRoot(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
      } catch (e) {
        // A slot acquired and then never released permanently shrinks the pool;
        // enough of those and every future job waits forever on a queue nothing
        // will ever drain. spawn() throwing is rare (bad binary path, EMFILE)
        // but it is precisely the path that would leak, so it is handled before
        // teardown() exists to handle it.
        slotHeld = false;
        releaseSlot();
        const msg = e instanceof Error ? e.message : "Could not start the CLI process";
        updateJob(jobId, { status: "error", endedAt: Date.now(), error: msg });
        send({ type: "error", msg });
        if (writeToken !== null) releaseTrackerWrite(writeToken);
        try { controller.close(); } catch { /* */ }
        closed = true;
        return;
      }
      const proc = child; // narrowed, non-null alias for the handlers below

      // Best-effort, opencode-only: capture the session id opencode assigns
      // itself, so a failure can later be replayed from its own transcript
      // instead of reasoning about a rolling stdout tail that's gone the
      // moment this request ends. Never awaited — must not delay anything.
      if (cliId === "opencode") {
        const spawnedAt = Date.now();
        void findOpencodeSessionId(spawnedAt).then((sid) => {
          if (sid) updateJob(jobId, { opencodeSessionId: sid });
        });
      }
      // startedAt is reset so elapsed time means "time actually working",
      // not "time since you clicked", which would make queued jobs look slow.
      updateJob(jobId, { status: "running", startedAt: Date.now() });
      send({ type: "status", label: "Started" });

      // ── Teardown: the one place the child dies and the slot comes back ───
      // `opencode run` boots a file watcher and an event stream and routinely
      // NEVER EXITS after it has finished answering, so waiting on "close"
      // leaks the process forever. That is what left 92 orphaned agents on
      // this machine in one evening. Every terminal path calls this exactly
      // once: normal completion, error, timeout, and the VERDICT reap below.
      // Deliberately NOT called from cancel() — a client disconnect must let
      // the run finish and write its report.
      let tornDown = false;
      const teardown = () => {
        if (tornDown) return;
        tornDown = true;
        if (killer) clearTimeout(killer);
        if (reaper) clearTimeout(reaper);
        try { child?.kill("SIGTERM"); } catch { /* already gone */ }
        // SIGTERM is a request; opencode does not always honour it. Follow up
        // with SIGKILL so a wedged child can never outlive its job.
        const c = child;
        setTimeout(() => { try { c?.kill("SIGKILL"); } catch { /* already gone */ } }, 5_000).unref?.();
        if (slotHeld) {
          slotHeld = false;
          releaseSlot();
        }
      };

      killer = setTimeout(() => {
        killedByTimeout = true;
        try { child?.kill("SIGTERM"); } catch { /* ignore */ }
      }, killMs);

      // ── VERDICT reap ────────────────────────────────────────────────────
      // Every prompt above ends "output EXACTLY one final line: VERDICT: …",
      // and each one is explicit that all writing and merging happens BEFORE
      // that line. So a VERDICT on stdout means the work is done — regardless
      // of whether the process ever intends to exit, which `opencode run`
      // frequently does not.
      //
      // Waiting for "close" is what leaked a process per evaluation all night.
      // The short grace period lets a final flush land before SIGTERM, rather
      // than racing the child's own last writes.
      const REAP_GRACE_MS = 2_000;
      const maybeReap = () => {
        if (finished || reaper) return;
        if (!/VERDICT:\s*[\d.]+\s*\/\s*5/i.test(textTail)) return;
        send({ type: "status", label: "Verdict received — wrapping up" });
        reaper = setTimeout(() => {
          // finishDone() calls teardown(), which kills the child and returns
          // the concurrency slot. Without this the slot would be held by a
          // process that finished minutes ago and the pool would drain to zero.
          finishDone();
          close();
        }, REAP_GRACE_MS);
      };
      // Every terminal outcome goes through these two so the durable registry
      // (survives a dead connection) and the live SSE event (nice for an open
      // tab) can never drift apart — one call site instead of six.
      const finishDone = () => {
        if (finished) return;
        finished = true;
        const vm = textTail.match(/VERDICT:\s*([\d.]+)\s*\/\s*5\s*[—:|-]+\s*(.+)/i);
        let score: number | null = null;
        let reason: string | undefined;
        if (vm) {
          score = parseFloat(vm[1]);
          reason = vm[2].trim().slice(0, 200);
        } else {
          const s = textTail.match(/\b([0-5](?:\.\d)?)\s*\/\s*5\b/);
          if (s) score = parseFloat(s[1]);
        }
        send({ type: "done", tokens: lastTokens, costUsd: lastCostUsd });
        updateJob(jobId, {
          status: "done",
          endedAt: Date.now(),
          result: { score, reason, tokens: lastTokens, costUsd: lastCostUsd ?? undefined },
        });
        teardown();
      };
      const finishError = (msg: string) => {
        if (finished) return;
        finished = true;
        send({ type: "error", msg });
        updateJob(jobId, {
          status: killedByTimeout ? "timeout" : "error",
          endedAt: Date.now(),
          error: killedByTimeout ? `Timed out after ${Math.round(killMs / 1000)}s — the CLI didn't finish in time.` : msg,
        });
        teardown();
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

      proc.stdout!.on("data", (d: Buffer) => {
        if (closed) return;
        if (!isClaude) {
          emittedText = true;
          const t = d.toString();
          textTail = (textTail + t).slice(-4000);
          send({ type: "text", text: t });
          maybeReap();
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
                textTail = (textTail + e.delta.text).slice(-4000);
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
      proc.stderr!.on("data", (d: Buffer) => {
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
          textTail = (textTail + s).slice(-4000);
          send({ type: "text", text: s });
        }
      });
      proc.on("error", (e) => { finishError(e.message); close(); });
      proc.on("close", (code) => {
        // child.on("error") may already have run finishError() for this same
        // terminal outcome — Node still fires "close" afterward. finishDone/
        // finishError are themselves idempotent (guarded by `finished`), so
        // this would be a no-op rather than a double registry write; still
        // skip the (otherwise pointless) branch evaluation below when so.
        if (finished) return;
        const ownReportFile = findOwnReport();
        const wroteReport = ownReportFile != null;
        const cleanExit = code === 0; // non-zero OR null (killed/signal) = NOT clean
        // A VERDICT line is the completion signal EVERY prompt in buildPrompt()
        // is instructed to emit as its LAST line, only after all real work
        // (writing, merging) is already done. Proven case: a scan-broad run
        // whose own opencode transcript (message.finish === "stop", correctly
        // written pipeline.md + scan-history.tsv rows) shows a completely
        // successful turn ending in "VERDICT: 5/5 — 2 new role(s) added to
        // your inbox" — yet the child process then closed with a non-zero/
        // killed exit code, and the OLD cleanExit-only check below banked that
        // as a failure. opencode routinely does not exit(0) even after
        // finishing correctly (it can hang on its own file watcher/event
        // stream, or get reaped once its output is fully read) — requiring a
        // clean exit for non-persisting kinds (research/fix-portal/scan-broad)
        // misclassified a near-guaranteed fraction of genuinely successful
        // runs on this CLI.
        //
        // Deliberately NOT gated on `!sawError` — caught live, by the very
        // transcript tool this fix's own commit added: a SECOND real
        // scan-broad success ("VERDICT: 2/5 — 0 new role(s) added to your
        // inbox", model's own reasoning confirming it correctly checked every
        // candidate and found nothing new) still got banked as an error,
        // because `sawError` had fired on ordinary tool noise somewhere in
        // 90+ seconds of bash/WebSearch output — the exact false-positive
        // failure mode already called out two branches below for the
        // evaluate path ("a blunt stderr keyword match... false-positives on
        // ordinary, expected tool noise"). A VERDICT line only ever appears
        // after all real work is done, so nothing that happened earlier in
        // the run should be able to override it after the fact.
        //
        // The "/5" is optional: the FIRST live test caught qwen3.7-plus
        // writing "VERDICT: 5 — ..." with no "/5" at all, which the original,
        // stricter pattern missed.
        const verdictSeen = /VERDICT:\s*[\d.]+(?:\s*\/\s*5)?\b/i.test(textTail);
        // Honesty gate (#9): a green "done" with a parsed score requires a CLEAN exit,
        // real output, AND (for evaluations) a report actually written. Anything else
        // is surfaced — an errored run must never be banked as a confident score.
        if (!emittedText && !sawError && !cleanExit) {
          finishError("The CLI exited with an error — is it installed and authenticated?");
        } else if (!emittedText && !sawError) {
          finishError("The CLI produced no output — is it installed and authenticated? (career-ops is best on Claude Code.)");
        } else if (persists && !wroteReport) {
          // The worker ran but never wrote the report/tracker row (e.g. a CLI
          // without file-write authorization) — surface it instead of a fake score.
          finishError("This evaluation didn't save a report, so it's not in your tracker. Full evaluation is verified on Claude Code.");
        } else if (persists && wroteReport) {
          // A report carrying THIS job's own URL in its header (see
          // findOwnReport) is the strongest possible evidence the real
          // modes/oferta.md pipeline actually completed FOR THIS POSTING —
          // `sawError` is only a blunt stderr keyword match (e.g. "not found")
          // and false-positives on ordinary, expected tool noise (a Read on
          // an optional file like article-digest.md that doesn't exist).
          // Don't let that flip a genuinely finished, persisted evaluation to
          // "failed, re-run it". `persists` is exactly `kind === "evaluate"`
          // — the only kind the shortlist has any opinion about.
          //
          // But a written report is necessary, NOT sufficient: it only proves
          // step 2 of oferta.md's five. Finish steps 3-4 here (idempotently,
          // via reconcile-report.mjs) and require the role to actually BE in
          // the tracker before calling this done and dropping it from the
          // shortlist. Otherwise a run that died right after writing its
          // report leaves a role in neither the shortlist nor Evaluated —
          // exactly how eleven of them went missing in one sitting.
          const tracked = reconcileReportIntoTracker(ownReportFile!, careerOpsRoot());
          if (tracked) {
            removeFromShortlistOnScore(input, careerOpsRoot());
            finishDone();
          } else {
            finishError(
              "The evaluation wrote its report, but it couldn't be merged into your tracker — so it isn't in Evaluated yet and the role stays in your shortlist. Re-run it, or run `node reconcile-report.mjs --all`.",
            );
          }
        } else if (verdictSeen) {
          finishDone();
        } else if (!cleanExit || sawError) {
          // Produced output (maybe even a report) but did NOT finish cleanly — flag it
          // instead of recording a confident score off a half-finished run.
          finishError("This run hit an error before finishing, so it isn't recorded as a confident result — re-run it to verify.");
        } else {
          finishDone();
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
