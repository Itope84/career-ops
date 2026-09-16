"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, Check, AlertTriangle, Settings } from "lucide-react";
import Link from "next/link";
import { useJobs } from "@/components/jobs/job-store";
import { CostBadge } from "@/components/cost/cost-badge";
import { cn } from "@/lib/cn";

// Runs the AGENT-driven side of portal discovery — portals.yml's search_queries
// (Level 3, WebSearch across Ashby/Greenhouse/Lever/Workable) plus liveness
// verification — the coverage the free "Scan portals" button can't reach
// because it's a plain zero-token script with no WebSearch access. Uses the
// SAME CLI backend (/api/run) as Evaluate, so it spends tokens — gated behind
// an explicit confirm, same convention as the shortlist's "Score N" button.

type Phase = "idle" | "confirm" | "running" | "done" | "error";

export function BroadSearchButton() {
  const router = useRouter();
  const { jobs, startJob } = useJobs();
  const [phase, setPhase] = useState<Phase>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [hasCli, setHasCli] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const c = localStorage.getItem("career-ops:config");
      if (c && JSON.parse(c).cliId) {
        setHasCli(true);
        return;
      }
    } catch {
      /* ignore */
    }
    fetch("/api/clis")
      .then((r) => r.json())
      .then((d) => setHasCli(!!d?.clis?.some((x: { installed: boolean }) => x.installed)))
      .catch(() => {});
  }, []);

  // The broad search this button is showing. Looking up by the locally-held
  // `jobId` alone was the bug: both `jobId` and `phase` are component state, so
  // navigating away and back remounts with jobId=null and phase="idle" — the
  // spinner vanished and the button re-enabled while the run was still going,
  // which is exactly the "state doesn't survive leaving the page" this was
  // supposed to have fixed. The durable registry already knows (the job store
  // adopts unknown running jobs from GET /api/jobs), so fall back to the most
  // recent scan-broad job in the store rather than trusting local memory.
  const latestBroad = jobs
    .filter((j) => j.kind === "scan-broad")
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  const job = jobs.find((j) => j.id === jobId) ?? latestBroad;

  // Re-adopt a run that outlived this component, so the button comes back
  // disabled + spinning instead of idle.
  useEffect(() => {
    if (jobId || !latestBroad || latestBroad.status !== "running") return;
    setJobId(latestBroad.id);
    setPhase("running");
  }, [jobId, latestBroad]);

  useEffect(() => {
    if (!job) return;
    // Only announce a FINISH we were actually watching. Without this, the
    // fallback above would surface an old completed run on every mount —
    // flashing "Done" and firing router.refresh() for a search that ended
    // hours ago. Adoption (above) deliberately only takes `running` jobs.
    if (job.id !== jobId) return;
    if (job.status === "done") {
      setPhase("done");
      router.refresh();
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setPhase("idle"), 8000);
    } else if (job.status === "error") {
      setPhase("error");
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setPhase("idle"), 10000);
    }
  }, [job, router]);

  function run() {
    const id = startJob({ title: "Broad search", subtitle: "search_queries across Ashby/Greenhouse/Lever/Workable", kind: "scan-broad", input: "portals.yml", page: "/pipeline" });
    if (id) {
      setJobId(id);
      setPhase("running");
    }
  }

  if (phase === "confirm") {
    if (!hasCli) {
      return (
        <span className="inline-flex items-center gap-2 text-xs">
          <span className="text-muted">No AI configured.</span>
          <Link href="/config" className="inline-flex items-center gap-1 rounded-full border border-brand/40 bg-brand-soft px-3 py-1.5 font-medium text-brand max-sm:min-h-[44px]">
            <Settings className="size-3.5" /> Set up
          </Link>
          <button type="button" onClick={() => setPhase("idle")} className="text-faint hover:text-foreground max-sm:min-h-[44px]">
            Cancel
          </button>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-2 text-xs">
        <span className="hidden text-muted sm:inline">Uses tokens — runs a live AI search</span>
        <button
          type="button"
          onClick={run}
          className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-xs font-medium text-brand-foreground transition-colors hover:bg-brand-200 max-sm:min-h-[44px]"
        >
          Run broad search
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
          title="Run search_queries (Ashby/Greenhouse/Lever/Workable WebSearch) + liveness checks via AI — finds roles the free scan can't reach"
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors max-sm:min-h-[44px]",
            phase === "running"
              ? "cursor-wait border-brand/40 bg-brand-soft text-brand"
              : "border-border text-muted hover:border-brand/40 hover:text-brand",
          )}
        >
          {phase === "running" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {phase === "running" ? "Searching…" : "Broad search (AI)"}
        </button>
        {phase === "idle" && <CostBadge kind="spend" size="xs" />}
      </span>
      {phase === "done" && job?.result && (
        <span className="animate-terminal-popup inline-flex items-center gap-1 text-xs font-medium text-brand">
          <Check className="size-3" /> {job.result.summary || "Search finished"}
        </span>
      )}
      {phase === "error" && (
        <span className="inline-flex max-w-[18rem] items-center gap-1 text-xs text-red-500 sm:max-w-xs" title={job?.text?.slice(-200)}>
          <AlertTriangle className="size-3 shrink-0" /> <span className="truncate">Broad search failed — see Jobs for details</span>
        </span>
      )}
    </div>
  );
}
