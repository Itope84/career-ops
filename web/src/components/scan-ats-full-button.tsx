"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Globe2, Loader2, Check, AlertTriangle } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { CostBadge } from "@/components/cost/cost-badge";
import { cn } from "@/lib/cn";

// Runs the REVERSE ATS scan (scan-ats-full.mjs via /api/scan-ats-full): walks
// the public per-ATS company directories — Greenhouse 8.3k, Lever 4.4k, Ashby
// 3.2k, Workday 12.9k — and keeps postings matching portals.yml's
// title_filter/location_filter. No company curation, and ZERO tokens (pure
// HTTP + JSON through the same providers/ modules as the free scan).
//
// Separate button from "Scan portals" on purpose: this runs ~10-20 minutes
// against that one's ~5 seconds, so they can't share a single "scanning…"
// state. It asks for confirmation for the same reason — the cost here is TIME,
// not tokens, so the CostBadge stays "free" while the confirm names the wait.

type Phase = "idle" | "confirm" | "running" | "done" | "error";

export function ScanAtsFullButton() {
  const router = useRouter();
  const { jobs, startJob } = useJobs();
  const [phase, setPhase] = useState<Phase>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Same durability problem BroadSearchButton hit: `jobId`/`phase` are
  // component state, so navigating away (or closing the app) and coming back
  // remounts with jobId=null/phase="idle" — the spinner would vanish while a
  // 20-minute scan was still going. The registry is the source of truth (the
  // store adopts unknown running jobs from GET /api/jobs), so fall back to the
  // most recent scan-ats-full job rather than trusting local memory.
  const latest = jobs
    .filter((j) => j.kind === "scan-ats-full")
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  const job = jobs.find((j) => j.id === jobId) ?? latest;

  // Re-adopt a run that outlived this component.
  useEffect(() => {
    if (jobId || !latest || latest.status !== "running") return;
    setJobId(latest.id);
    setPhase("running");
  }, [jobId, latest]);

  useEffect(() => {
    if (!job) return;
    // Only announce a finish we were actually watching — otherwise the fallback
    // above would flash "Done" on every mount for a scan that ended hours ago.
    if (job.id !== jobId) return;
    if (job.status === "done") {
      setPhase("done");
      router.refresh();
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setPhase("idle"), 10000);
      // A server-side timeout arrives here as "error" — the job store maps the
      // registry's "timeout" onto it and carries the distinction in the label.
    } else if (job.status === "error") {
      setPhase("error");
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setPhase("idle"), 12000);
    }
  }, [job, jobId, router]);

  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);

  function run() {
    const id = startJob({
      title: "Scan ATS Full",
      subtitle: "Greenhouse · Lever · Ashby · Workday directories",
      kind: "scan-ats-full",
      input: "ats-directories",
      page: "/pipeline",
    });
    if (id) {
      setJobId(id);
      setPhase("running");
    }
  }

  if (phase === "confirm") {
    return (
      <span className="inline-flex items-center gap-2 text-xs">
        <span className="hidden text-muted sm:inline">Free, but takes 10–20 min</span>
        <button
          type="button"
          onClick={run}
          className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-xs font-medium text-brand-foreground transition-colors hover:bg-brand-200 max-sm:min-h-[44px]"
        >
          Start full scan
        </button>
        <button type="button" onClick={() => setPhase("idle")} className="text-faint hover:text-foreground max-sm:min-h-[44px]">
          Cancel
        </button>
      </span>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setPhase("confirm")}
          disabled={phase === "running"}
          title="Walk every company on Greenhouse/Lever/Ashby/Workday and keep the postings matching your filters — no company list needed. Zero tokens, but takes 10–20 minutes."
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors max-sm:min-h-[44px]",
            phase === "running"
              ? "cursor-wait border-brand/40 bg-brand-soft text-brand"
              : "border-border text-muted hover:border-brand/40 hover:text-brand",
          )}
        >
          {phase === "running" ? <Loader2 className="size-3.5 animate-spin" /> : <Globe2 className="size-3.5" />}
          {phase === "running" ? "Scanning ATS…" : "Scan ATS Full"}
        </button>
        {phase === "idle" && <CostBadge kind="free" size="xs" />}
      </span>
      {phase === "running" && job?.text && (
        <span className="max-w-[18rem] truncate text-xs text-faint sm:max-w-xs" title={job.text}>
          {job.text}
        </span>
      )}
      {phase === "done" && job?.result && (
        <span className="animate-terminal-popup inline-flex items-center gap-1 text-xs font-medium text-brand">
          <Check className="size-3" /> {job.result.summary || "Full ATS scan finished"}
        </span>
      )}
      {phase === "error" && (
        <span className="inline-flex max-w-[18rem] items-center gap-1 text-xs text-red-500 sm:max-w-xs" title={job?.text?.slice(-200)}>
          <AlertTriangle className="size-3 shrink-0" /> <span className="truncate">Full ATS scan failed — see Jobs for details</span>
        </span>
      )}
    </div>
  );
}
