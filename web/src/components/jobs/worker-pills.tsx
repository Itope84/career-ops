"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, History, AlertTriangle } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { WorkerCard, pillTone, TONE } from "@/components/jobs/worker-card";
import { cn } from "@/lib/cn";

// Back-compat re-exports (app/jobs/page.tsx imports pillTone from here).
export { pillTone, TONE };

// Collapsed "worker" pills in the sidebar — each the shared <WorkerCard> wrapped
// in a Link to its detail. Same component the assistant chat renders inline.
//
// The full tool-by-tool transcript this renders is a debugging surface, not a
// daily-use one — gated behind DEBUG_ENABLED. Knowing that something FAILED is
// not a debug concern, though, so a plain failure count still shows (linking
// to /jobs) even with the flag off — see FailuresIndicator below.
export function WorkerPills() {
  const { jobs, removeJob, clearFinished, debugEnabled } = useJobs();
  const pathname = usePathname();
  if (!debugEnabled) return <FailuresIndicator jobs={jobs} />;
  if (jobs.length === 0) return null;
  const running = jobs.filter((j) => j.status === "running").length;
  const finished = jobs.length - running;

  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-faint">Workers</span>
        {running > 0 && <span className="text-[10px] tabular-nums text-brand">{running} running</span>}
        <Link href="/jobs" className="ml-auto text-faint transition-colors hover:text-foreground" title="History" aria-label="Worker history">
          <History className="size-3.5" />
        </Link>
        {finished > 0 && (
          <button onClick={clearFinished} className="text-[10px] text-faint transition-colors hover:text-foreground" title="Clear finished">
            clear
          </button>
        )}
      </div>
      <ul className="space-y-1.5">
        {jobs.slice(0, 6).map((j) => {
          const active = pathname === `/jobs/${j.id}`;
          return (
            <li key={j.id}>
              <Link
                href={`/jobs/${j.id}`}
                className={cn(
                  "group block rounded-lg border px-2.5 py-2 transition-colors",
                  active ? "border-brand/50 bg-brand-soft" : "border-border bg-surface/60 hover:bg-surface-hover",
                )}
              >
                <WorkerCard
                  job={j}
                  variant="tray"
                  trailing={
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        removeJob(j.id);
                      }}
                      className="text-faint opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                      aria-label="Dismiss job"
                    >
                      <X className="size-3" />
                    </button>
                  }
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Always visible regardless of DEBUG_ENABLED — the point of this whole thing
// is that a failure (misconfiguration, a spent quota, a CLI that crashed
// mid-run) never goes unnoticed just because nobody was watching the debug
// transcript. Renders nothing when there's nothing to report.
function FailuresIndicator({ jobs }: { jobs: ReturnType<typeof useJobs>["jobs"] }) {
  const failed = jobs.filter((j) => j.status === "error");
  if (failed.length === 0) return null;
  return (
    <div className="mt-4 border-t border-border pt-3">
      <Link
        href="/jobs"
        className="flex items-center gap-2 rounded-lg border border-red-500/25 bg-red-500/5 px-2.5 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
      >
        <AlertTriangle className="size-3.5 shrink-0" />
        {failed.length} failed run{failed.length === 1 ? "" : "s"} — view
      </Link>
    </div>
  );
}
