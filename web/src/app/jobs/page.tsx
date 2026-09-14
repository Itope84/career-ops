"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, AlertTriangle, Loader2, Trash2, HelpCircle } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { pillTone } from "@/components/jobs/worker-pills";
import { cn } from "@/lib/cn";

const TONE_CHIP = {
  good: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  bad: "bg-red-500/15 text-red-700 dark:text-red-400",
  muted: "bg-surface-hover text-muted",
} as const;

// Minimal display shape for a registry-only entry this tab never adopted —
// see the merge effect below for why that gap exists.
type RegistryOnly = {
  id: string;
  title: string;
  subtitle?: string;
  status: "running" | "queued" | "done" | "error" | "timeout";
  error?: string;
  score?: number | null;
  startedAt: number;
};

export default function JobsHistory() {
  const { jobs, clearFinished, debugEnabled } = useJobs();

  // The client's own `jobs` state only ever contains what THIS tab adopted —
  // and adoption only pulls in a job that is still running, or finished
  // within the last 10 minutes (see job-store.tsx's reconcile effect). That
  // window exists so a fresh page load doesn't flood the sidebar with ancient
  // history, but it means a run that failed while no tab was open is
  // invisible here FOREVER, even though the server-side registry (up to its
  // own 300-record cap) still remembers it perfectly well. A batch of 281
  // failed evaluations vanished this way in one night.
  //
  // This page is the one place that is supposed to be the full, honest
  // record, so it fetches the registry directly and fills in anything local
  // state is missing — the local copy wins where both exist, since it alone
  // carries the full tool-by-tool transcript the registry never stores.
  const [registryOnly, setRegistryOnly] = useState<RegistryOnly[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/jobs")
      .then((r) => r.json())
      .then((d: { jobs?: Array<{ id: string; title: string; subtitle?: string; status: string; error?: string; result?: { score: number | null }; startedAt: number }> }) => {
        if (cancelled || !Array.isArray(d.jobs)) return;
        const known = new Set(jobs.map((j) => j.id));
        setRegistryOnly(
          d.jobs
            .filter((r) => !known.has(r.id))
            .map((r) => ({
              id: r.id,
              title: r.title,
              subtitle: r.subtitle,
              status: r.status as RegistryOnly["status"],
              error: r.error,
              score: r.result?.score ?? null,
              startedAt: r.startedAt,
            })),
        );
      })
      .catch(() => {
        /* offline — the local list is still shown */
      });
    return () => {
      cancelled = true;
    };
    // Re-fetch whenever the local list changes (a dismiss, a new job, a
    // finish) so a job doesn't linger duplicated or missing after either side updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.length]);

  // Both sources normalize into this one display shape so the list below
  // doesn't need to branch on which side a row came from. `detail` links to
  // the full transcript when this tab has it; a registry-only row still links
  // to /jobs/[id], which honestly says "no longer in memory" rather than
  // pretending the row doesn't exist.
  type Row = { id: string; title: string; subtitle?: string; status: string; reason?: string; score?: number | null; tone: keyof typeof TONE_CHIP; startedAt: number; hasDetail: boolean };
  const fromJob = (j: (typeof jobs)[number]): Row => ({
    id: j.id,
    title: j.title,
    subtitle: j.subtitle,
    status: j.status,
    reason: j.status === "error" ? j.steps[j.steps.length - 1]?.label : undefined,
    score: j.result?.score,
    tone: pillTone(j),
    startedAt: j.startedAt,
    hasDetail: true,
  });
  const fromRegistry = (r: RegistryOnly): Row => ({
    id: r.id,
    title: r.title,
    subtitle: r.subtitle,
    status: r.status,
    reason: r.status === "error" || r.status === "timeout" ? r.error : undefined,
    score: r.score,
    tone: r.status === "error" || r.status === "timeout" ? "bad" : r.status === "done" ? "good" : "muted",
    startedAt: r.startedAt,
    hasDetail: false,
  });

  // Without DEBUG_ENABLED this page is reached only via the sidebar's failure
  // link — the full tool-by-tool history is a debugging surface, but knowing
  // *why* something failed is not, so it narrows to just that instead of
  // disappearing entirely.
  const visible: Row[] = debugEnabled
    ? [...jobs.map(fromJob), ...registryOnly.map(fromRegistry)].sort((a, b) => b.startedAt - a.startedAt)
    : [
        ...jobs.filter((j) => j.status === "error").map(fromJob),
        ...registryOnly.filter((j) => j.status === "error" || j.status === "timeout").map(fromRegistry),
      ].sort((a, b) => b.startedAt - a.startedAt);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-landing">{debugEnabled ? "Workers" : "Failures"}</h1>
          <p className="mt-1 text-sm text-muted">
            {debugEnabled ? (
              <>Every evaluation you ran — a persistent log. <span className="tabular-nums">{visible.length}</span> total.</>
            ) : (
              <>Runs that didn't finish cleanly. <span className="tabular-nums">{visible.length}</span> to look at.</>
            )}
          </p>
        </div>
        {debugEnabled && jobs.some((j) => j.status !== "running") && (
          <button
            onClick={clearFinished}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <Trash2 className="size-3.5" /> Clear finished
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-12 text-center text-sm text-muted">
          {debugEnabled ? (
            <>No workers yet. Hit <span className="text-foreground">Evaluate</span> on an inbox posting to spin one up.</>
          ) : (
            "Nothing to report — every run so far has finished cleanly."
          )}
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface/40">
          {visible.map((j) => (
            <li key={j.id}>
              <Link href={`/jobs/${j.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover">
                {j.status === "running" || j.status === "queued" ? (
                  <Loader2 className="size-4 shrink-0 animate-spin text-brand" />
                ) : j.status === "error" || j.status === "timeout" ? (
                  <AlertTriangle className="size-4 shrink-0 text-red-400" />
                ) : j.status === "done" ? (
                  <Check className="size-4 shrink-0 text-emerald-500" />
                ) : (
                  // Shouldn't happen — an unrecognized status is surfaced rather
                  // than silently picking a misleading icon.
                  <HelpCircle className="size-4 shrink-0 text-faint" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{j.title}</div>
                  {(j.reason || j.subtitle) && <div className="truncate text-xs text-muted">{j.reason || j.subtitle}</div>}
                  {/* A row this tab never adopted only has the registry's bare
                      facts — flagged so a click landing on "no longer in
                      memory" isn't a surprise. */}
                  {!j.hasDetail && <div className="truncate text-[11px] italic text-faint">from an earlier session — no live transcript</div>}
                </div>
                {j.score != null && (
                  <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums", TONE_CHIP[j.tone])}>{j.score}/5</span>
                )}
                <span className="hidden shrink-0 text-xs capitalize text-faint sm:block">{j.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
