"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Radar, Loader2, Check, AlertTriangle } from "lucide-react";
import { CostBadge } from "@/components/cost/cost-badge";
import { useJobs } from "@/components/jobs/job-store";
import { cn } from "@/lib/cn";

// One-tap portal scan from the pipeline header. Runs the real zero-token
// scan.mjs via /api/scan (portals.yml + profile filters → new inbox rows).
//
// Routed through the shared job store (useJobs) rather than its own local
// state, specifically so this button's running/disabled state survives a
// reload, a dropped connection, or opening the app on a different device —
// it's reconciled against the durable server-side registry (see
// run-registry.ts), not just whatever this one tab happened to see over its
// own SSE stream.
export function ScanButton() {
  const router = useRouter();
  const { jobs, startJob } = useJobs();
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshedFor = useRef<string | null>(null);

  // Most recent scan job this client knows about (own or adopted from another
  // session) — that's the button's entire state machine.
  const current = jobs.find((j) => j.kind === "scan");
  const phase: "idle" | "running" | "done" | "error" =
    !current || current.id === dismissedId ? "idle" : current.status === "running" ? "running" : current.status;

  // Refresh the inbox exactly once per completed scan, whichever tab notices first.
  useEffect(() => {
    if (current?.status === "done" && refreshedFor.current !== current.id) {
      refreshedFor.current = current.id;
      router.refresh();
    }
  }, [current?.status, current?.id, router]);

  useEffect(() => {
    if (phase !== "done" && phase !== "error") return;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => current && setDismissedId(current.id), phase === "done" ? 6000 : 8000);
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, [phase, current]);

  function run() {
    if (phase === "running") return;
    setDismissedId(null);
    startJob({ title: "AI Search", kind: "scan", input: "portals.yml" });
  }

  const label = current?.steps[current.steps.length - 1]?.label || "Scanning…";
  const summary = current?.result?.summary ?? "";

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={run}
          disabled={phase === "running"}
          title="Scan your tracked portals for new roles — free, no tokens spent"
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors max-sm:min-h-[44px]",
            phase === "running"
              ? "cursor-wait border-brand/40 bg-brand-soft text-brand"
              : "border-border text-muted hover:border-brand/40 hover:text-brand",
          )}
        >
          {phase === "running" ? <Loader2 className="size-3.5 animate-spin" /> : <Radar className="size-3.5" />}
          {phase === "running" ? "Scanning portals…" : "Scan portals"}
        </button>
        {phase === "idle" && <CostBadge kind="free" size="xs" />}
      </span>
      {phase === "running" && (
        <span className="max-w-[16rem] truncate font-mono text-[11px] text-faint sm:max-w-xs" title={label}>
          {label}
        </span>
      )}
      {phase === "done" && (
        <span className="animate-terminal-popup inline-flex items-center gap-1 text-xs font-medium text-brand">
          <Check className="size-3" /> {summary}
        </span>
      )}
      {phase === "error" && (
        <span className="inline-flex max-w-[18rem] items-center gap-1 text-xs text-red-500 sm:max-w-xs" title={current?.steps[current.steps.length - 1]?.label}>
          <AlertTriangle className="size-3 shrink-0" /> <span className="truncate">{current?.steps[current.steps.length - 1]?.label || "Scan failed"}</span>
        </span>
      )}
    </div>
  );
}
