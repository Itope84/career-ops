"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { scoreTone } from "@/lib/format";

export type JobStep = { kind: "tool" | "status"; label: string; ts: number };
export type JobResult = { score: number | null; summary: string; tone: "good" | "warn" | "bad" | "muted" };

export type Job = {
  id: string;
  title: string;
  subtitle?: string;
  page?: string; // route the job was launched from / refers to
  input?: string; // the URL/posting it processed (links inbox rows to their worker)
  kind?: string;
  batchId?: string; // groups jobs fired together (e.g. "evaluate all Anthropic")
  status: "running" | "done" | "error";
  steps: JobStep[];
  text: string;
  result?: JobResult;
  cost?: { tokens: number; usd?: number }; // per-run token cost (Claude result event) — local only
  startedAt: number;
  endedAt?: number;
  /** Present only when this ran on opencode — its own internal session id.
   *  Lets the debug UI offer "load full transcript" straight from opencode's
   *  own database instead of whatever partial text this tab happened to see live. */
  opencodeSessionId?: string;
};

type StartOpts = { title: string; subtitle?: string; kind: string; input: string; page?: string; batchId?: string };

type Ctx = {
  jobs: Job[];
  startJob: (opts: StartOpts) => string | null;
  removeJob: (id: string) => void;
  clearFinished: () => void;
  /** Server-computed DEBUG_ENABLED flag — gates the raw worker-transcript
   *  surfaces (sidebar Workers panel, /jobs history). Defaults false until the
   *  first /api/jobs poll lands, which is the safer default either way. */
  debugEnabled: boolean;
};

// Shape of one record from GET /api/jobs — the durable, connection-independent
// registry (see web/src/lib/core/run-registry.ts). Kept minimal/duplicated
// here rather than imported: that module is server-only (uses node:fs) and
// this file is "use client".
type RegistryJob = {
  id: string;
  kind: string;
  title: string;
  subtitle?: string;
  input: string;
  status: "queued" | "running" | "done" | "error" | "timeout";
  startedAt: number;
  endedAt?: number;
  result?: { score: number | null; reason?: string; tokens?: number; costUsd?: number };
  error?: string;
  opencodeSessionId?: string;
};

const JobsContext = createContext<Ctx | null>(null);
export function useJobs() {
  const c = useContext(JobsContext);
  if (!c) throw new Error("useJobs must be used within <JobsProvider>");
  return c;
}

const CONFIG_KEY = "career-ops:config";
const JOBS_KEY = "career-ops:jobs";

/** Apply a finished (non-"running") registry record onto a local Job — the
 *  one place that turns the durable registry's shape into this file's Job
 *  shape, used by both the "patch a known job" and "adopt an unknown job"
 *  paths in the reconciliation effect below. */
/** Not finished yet. "queued" means accepted and durable but still waiting for
 *  a concurrency slot (job-queue.ts) — it has NOT failed, and treating it as a
 *  terminal state would flip every waiting job in a 99-job batch to "error". */
function stillPending(status: RegistryJob["status"]): boolean {
  return status === "running" || status === "queued";
}

function applyRegistryResult(job: Job, r: RegistryJob): Job {
  const score = r.result?.score ?? null;
  const tone = score != null ? scoreTone(String(score)) : "muted";
  const label =
    r.status === "timeout" ? `Timed out — ${r.error || "the run didn't finish in time"}`
    : r.status === "error" ? r.error || "Failed in background"
    : "Finished in background";
  return {
    ...job,
    // "timeout" is a registry-only distinction (surfaced via the label/error
    // above); the UI's tone/badge model only needs done vs. error.
    status: r.status === "done" ? "done" : "error",
    result: r.status === "done" ? { score, summary: r.result?.reason || "Evaluated in background", tone } : undefined,
    cost: r.result?.tokens ? { tokens: r.result.tokens, usd: r.result.costUsd } : job.cost,
    opencodeSessionId: r.opencodeSessionId ?? job.opencodeSessionId,
    endedAt: r.endedAt ?? Date.now(),
    steps: [...job.steps, { kind: "status", label, ts: Date.now() }],
  };
}

function parseVerdict(text: string): JobResult {
  const m = text.match(/VERDICT:\s*([\d.]+)\s*\/\s*5\s*[—:|-]+\s*(.+)/i);
  if (m) {
    const score = parseFloat(m[1]);
    return { score, summary: m[2].trim().replace(/\s+/g, " ").slice(0, 90), tone: scoreTone(`${score}`) };
  }
  const s = text.match(/\b([0-5](?:\.\d)?)\s*\/\s*5\b/);
  if (s) {
    const score = parseFloat(s[1]);
    return { score, summary: "", tone: scoreTone(`${score}`) };
  }
  return { score: null, summary: "", tone: "muted" };
}

export function JobsProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const seq = useRef(0);
  const loaded = useRef(false);

  // restore history
  useEffect(() => {
    try {
      const raw = localStorage.getItem(JOBS_KEY);
      const arr = raw ? JSON.parse(raw) : null;
      if (Array.isArray(arr)) {
        // We DO NOT mark running jobs as interrupted anymore.
        // Let them stay running so the background poller can adopt them.
        setJobs(arr);
      }
    } catch {
      /* ignore */
    }
    loaded.current = true;
  }, []);

  // persist
  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(JOBS_KEY, JSON.stringify(jobs.slice(0, 40)));
    } catch {
      /* quota */
    }
  }, [jobs]);

  const [debugEnabled, setDebugEnabled] = useState(false);

  // Reconcile against the durable, connection-independent job registry
  // (GET /api/jobs — see run-registry.ts). This is the actual fix for "we
  // always lose connection when we go away from the active page": the
  // registry is written by the SAME server-side process handler that detects
  // success/failure/timeout, independent of whether any browser is attached,
  // so it's authoritative regardless of what this tab's own SSE stream saw.
  //
  // Two things happen on every poll:
  //   1. Known local jobs still marked "running" get patched to whatever the
  //      registry says once it's no longer "running" — this replaces the old
  //      applications.md-guessing heuristic with an exact id match.
  //   2. Registry jobs this tab doesn't know about yet (started from another
  //      tab or device, or predating this page load) get adopted into the
  //      local list if they're running or finished recently — so opening the
  //      app fresh still shows "this is being scored" instead of nothing.
  useEffect(() => {
    let cancelled = false;
    const reconcile = async () => {
      let data: { debugEnabled?: boolean; jobs?: RegistryJob[] };
      try {
        const res = await fetch("/api/jobs");
        if (!res.ok || cancelled) return;
        data = await res.json();
      } catch {
        return; // offline / server restarting — next tick tries again
      }
      if (cancelled) return;
      setDebugEnabled(!!data.debugEnabled);
      const registryJobs = Array.isArray(data.jobs) ? data.jobs : [];
      if (registryJobs.length === 0) return;

      setJobs((curr) => {
        let changed = false;
        const seen = new Set(curr.map((j) => j.id));
        const justFinished: Job[] = [];

        const patched = curr.map((j) => {
          if (j.status !== "running") return j;
          const r = registryJobs.find((x) => x.id === j.id);
          if (!r || stillPending(r.status)) return j; // nothing new to apply yet
          changed = true;
          const next = applyRegistryResult(j, r);
          justFinished.push(next);
          return next;
        });

        const adopted: Job[] = [];
        for (const r of registryJobs) {
          if (seen.has(r.id)) continue;
          const isRecent = stillPending(r.status) || Date.now() - (r.endedAt ?? r.startedAt) < 10 * 60_000;
          if (!isRecent) continue;
          changed = true;
          const base: Job = {
            id: r.id,
            title: r.title,
            subtitle: r.subtitle,
            input: r.input,
            kind: r.kind,
            status: "running",
            steps: [{ kind: "status", label: r.status === "queued" ? "Queued — waiting for a worker slot" : "Detected from another session", ts: r.startedAt }],
            text: "",
            startedAt: r.startedAt,
          };
          const withResult = stillPending(r.status) ? base : applyRegistryResult(base, r);
          if (r.status !== "running") justFinished.push(withResult);
          adopted.push(withResult);
        }

        // Sweep two ways a local job goes stale, since neither self-heals:
        //
        //   1. GHOST RUNNING — a job this tab thinks is "running" but the
        //      registry no longer mentions at all. That happens when the
        //      registry's own 300-record cap rotates it out before this tab
        //      ever sees its terminal status (a big batch does this in
        //      minutes). Left alone it spins forever — nothing will ever
        //      match its id again. Past a generous safety window (double the
        //      longest server-side kill timeout, so a genuinely slow pdf/
        //      scan-broad run is never mistaken for lost), convert it to an
        //      honest "lost track" error instead of a permanent spinner.
        //
        //   2. UNBOUNDED GROWTH — nothing ever trimmed the in-memory array;
        //      only the localStorage WRITE was capped at 40, so a tab left
        //      open across a long batch just kept accreting every adopted
        //      job. That is where "300 total" on the Workers page came from —
        //      it grew to match the registry's own cap over one bad night.
        //      Cap it here too, keeping the newest first — the same order the
        //      UI already sorts and the same limit the persisted copy uses.
        const GHOST_TIMEOUT_MS = 24 * 60_000; // 2x the longest server kill timeout (720s)
        const swept = patched.map((j) => {
          if (j.status !== "running") return j;
          if (registryJobs.some((r) => r.id === j.id)) return j; // still known — leave it
          if (Date.now() - j.startedAt < GHOST_TIMEOUT_MS) return j; // could still be legitimately running
          changed = true;
          return {
            ...j,
            status: "error" as const,
            endedAt: Date.now(),
            steps: [...j.steps, { kind: "status" as const, label: "Lost track of this job — the server may have restarted or rotated it out of its log. Check /jobs or the tracker for the real outcome.", ts: Date.now() }],
          };
        });

        // SUCCESS ONLY. This event means "a worker wrote a real report / tracker
        // row — refetch". Firing it for a FAILED run caused real data loss: the
        // Shortlist tab removes a job when it hears this, so a batch of failed
        // evaluations silently deleted 65 shortlisted roles that were never
        // evaluated at all. The equivalent dispatch on the live-connection path
        // (in `finish` below) was always inside `if (status === "done")`; this
        // reconcile path was the one that wasn't, which is why it only bit
        // after a reload. `status` rides along so listeners can double-check.
        for (const j of justFinished) {
          if (j.status !== "done") continue;
          if (typeof window !== "undefined" && (j.kind === "evaluate" || j.kind === "pdf")) {
            window.dispatchEvent(new CustomEvent("co-job-done", { detail: { kind: j.kind, input: j.input, status: j.status } }));
          }
        }

        if (!changed) return curr;
        // Newest first, then capped — mirrors the limit the persisted copy
        // already used (`jobs.slice(0, 40)`), just applied to the live array
        // too instead of only what gets written to localStorage. A handful of
        // very-recent-but-old-timestamp adoptions could otherwise still push
        // the array past this on one tick; sorting first keeps the newest.
        const MAX_LIVE_JOBS = 60;
        return [...adopted, ...swept].sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_LIVE_JOBS);
      });
    };
    reconcile();
    const interval = setInterval(reconcile, 4000);
    const onVisible = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const patch = useCallback((id: string, fn: (j: Job) => Job) => {
    setJobs((js) => js.map((j) => (j.id === id ? fn(j) : j)));
  }, []);

  const startJob = useCallback(
    (opts: StartOpts): string | null => {
      let cliId: string | null = null;
      try {
        const raw = localStorage.getItem(CONFIG_KEY);
        cliId = raw ? JSON.parse(raw).cliId || null : null;
      } catch {
        cliId = null;
      }
      const id = `job-${Date.now()}-${seq.current++}`;
      const job: Job = {
        id,
        title: opts.title,
        subtitle: opts.subtitle,
        page: opts.page,
        input: opts.input,
        kind: opts.kind,
        batchId: opts.batchId,
        status: "running",
        steps: [{ kind: "status", label: "Starting…", ts: Date.now() }],
        text: "",
        startedAt: Date.now(),
      };
      setJobs((js) => [job, ...js]);

      // No saved Config selection is fine — /api/run resolves the server-side
      // default (Antigravity → Claude → first installed) and errors clearly
      // only when no engine exists at all.

      (async () => {
        let text = "";
        let verdictLine = ""; // latched separately so the 8000-char tail can't drop it
        let doneTokens = 0; // per-run token cost, forwarded on the done event (#6)
        let doneCostUsd: number | null = null;
        const steps: JobStep[] = [];
        const finish = (status: "done" | "error", lastLabel?: string) => {
          const result = status === "done" ? parseVerdict(verdictLine || text) : undefined;
          const cost = status === "done" && doneTokens > 0 ? { tokens: doneTokens, usd: doneCostUsd ?? undefined } : undefined;
          patch(id, (j) => ({
            ...j,
            status,
            result,
            cost,
            endedAt: Date.now(),
            steps: lastLabel ? [...j.steps, { kind: "status", label: lastLabel, ts: Date.now() }] : j.steps,
          }));
          // persist a readable log file so the CLI/assistant can read past runs
          if (status === "done") {
            fetch("/api/runs/save", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id, title: opts.title, subtitle: opts.subtitle, page: opts.page, input: opts.input, result, cost, steps, output: text }),
            }).catch(() => {});
            // Tell server-snapshot surfaces (Today, pipeline) to refetch — the
            // worker just wrote a real tracker row / report they don't yet see.
            if (typeof window !== "undefined" && (opts.kind === "evaluate" || opts.kind === "pdf")) {
              window.dispatchEvent(new CustomEvent("co-job-done", { detail: { kind: opts.kind, input: opts.input, status: "done" } }));
            }
          }
        };

        // Both zero-token script scans stream the same NDJSON shape and finish
        // through finishScan — they differ only in endpoint, how long they run
        // and what the summary counts (new inbox rows vs matched postings).
        const isAtsFull = opts.kind === "scan-ats-full";
        const isScan = opts.kind === "scan" || isAtsFull;
        let scanAdded: number | null = null;
        let scanCompanies: number | null = null;
        const finishScan = (status: "done" | "error", lastLabel?: string) => {
          const result: JobResult | undefined =
            status === "done"
              ? { score: null, summary: scanAdded === 0 ? "No new roles this time" : `${scanAdded ?? 0} new in inbox`, tone: (scanAdded ?? 0) > 0 ? "good" : "muted" }
              : undefined;
          patch(id, (j) => ({
            ...j,
            status,
            result,
            endedAt: Date.now(),
            steps: lastLabel ? [...j.steps, { kind: "status", label: lastLabel, ts: Date.now() }] : j.steps,
          }));
          if (status === "done" && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("co-job-done", { detail: { kind: opts.kind, input: opts.input } }));
        };

        try {
          const res = await fetch(isAtsFull ? "/api/scan-ats-full" : isScan ? "/api/scan" : "/api/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(isScan ? { id } : { id, kind: opts.kind, input: opts.input, cliId, title: opts.title, subtitle: opts.subtitle }),
          });
          if (!res.ok || !res.body) {
            const e = await res.json().catch(() => ({}));
            // A synchronous rejection before the process ever started (bad
            // input, no CLI installed, single-flight scan already running) —
            // nothing was registered server-side, so there's nothing for the
            // reconciliation poller to later correct. Safe to report now.
            if (isScan) finishScan("error", e.error || "Failed to start");
            else finish("error", e.error || "Failed to start");
            return;
          }
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf("\n")) !== -1) {
              const line = buf.slice(0, nl).trim();
              buf = buf.slice(nl + 1);
              if (!line) continue;
              try {
                const ev = JSON.parse(line);
                if (ev.type === "tool") {
                  steps.push({ kind: "tool", label: ev.name, ts: Date.now() });
                  patch(id, (j) => ({ ...j, steps: [...j.steps, { kind: "tool", label: ev.name, ts: Date.now() }] }));
                } else if (ev.type === "status" || ev.type === "line") {
                  const label = ev.label ?? ev.text ?? "";
                  steps.push({ kind: "status", label, ts: Date.now() });
                  patch(id, (j) => ({ ...j, steps: [...j.steps, { kind: "status", label, ts: Date.now() }], text: ev.type === "line" ? label : j.text }));
                } else if (ev.type === "text") {
                  const full = text + ev.text;
                  const vm = full.match(/VERDICT:[^\n]*/i);
                  if (vm) verdictLine = vm[0];
                  text = full.slice(-8000);
                  patch(id, (j) => ({ ...j, text }));
                } else if (ev.type === "done") {
                  // finish happens on stream-close; capture what it carries
                  if (typeof ev.tokens === "number") doneTokens = ev.tokens;
                  if (typeof ev.costUsd === "number") doneCostUsd = ev.costUsd;
                  if (typeof ev.added === "number") scanAdded = ev.added;
                  if (typeof ev.matches === "number") scanAdded = ev.matches;
                  if (typeof ev.companies === "number") scanCompanies = ev.companies;
                } else if (ev.type === "error") {
                  if (isScan) finishScan("error", ev.msg || "Error");
                  else finish("error", ev.msg || "Error");
                  return;
                }
                // "ping" (heartbeat) intentionally ignored — see /api/run's send() comment
              } catch {
                /* skip */
              }
            }
          }
          if (isScan) finishScan("done", scanAdded === 0 ? "No new roles" : `${scanAdded} new role(s) found`);
          else finish("done", "Done");
        } catch {
          // The live stream died — a dropped connection, a backgrounded tab,
          // a closed laptop lid. This is NOT necessarily a failed run: /api/run
          // and /api/scan both deliberately keep the underlying process alive
          // server-side (see their cancel() handlers) and record the REAL
          // outcome in the durable registry regardless of whether anyone is
          // still listening. So: don't guess "error" here — leave the job
          // "running" and let the reconciliation poller (above) apply whatever
          // the registry actually says, typically within a few seconds.
          patch(id, (j) => (j.status === "running" ? { ...j, steps: [...j.steps, { kind: "status", label: "Lost the live connection — checking status in the background…", ts: Date.now() }] } : j));
        }
      })();

      return id;
    },
    [patch],
  );

  const removeJob = useCallback((id: string) => setJobs((js) => js.filter((j) => j.id !== id)), []);
  const clearFinished = useCallback(() => setJobs((js) => js.filter((j) => j.status === "running")), []);

  return <JobsContext.Provider value={{ jobs, startJob, removeJob, clearFinished, debugEnabled }}>{children}</JobsContext.Provider>;
}
