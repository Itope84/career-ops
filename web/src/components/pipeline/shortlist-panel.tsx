"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { TriageRow, type RowScore } from "@/components/inbox/triage-row";
import { daysSince, sourceFromUrl } from "@/lib/inbox";
import type { ShortlistItem, InboxJob } from "@/lib/career-ops";

// The Shortlist tab — replaces what used to be the ALL tab (every tracker row,
// unfiltered — redundant with the status-specific tabs next to it). Backed by
// data/pipeline.md's `## Shortlisted` section (see shortlist-entries.mjs), not
// localStorage, so it's the same list on every device, not just this browser.
//
// Rows are the SAME card as the Inbox and Evaluated tabs (TriageRow), not a
// bespoke list: one posting looks and behaves identically wherever it appears.
// The three controls carry their shortlist meanings:
//   Score     → evaluate it now
//   Bookmark  → un-bookmark: the role goes BACK to the inbox (restore: true)
//   ✗         → delete it outright
//
// "Score selected" reuses the same background-job machinery every other
// action in this app does (useJobs().startJob) — the durable registry
// (run-registry.ts) is what makes each row's status survive a reload while
// scoring runs.
//
// Deliberately NO "score all": a batch that fires 99 jobs at once is exactly
// what took this app's host machine down for an evening (see job-queue.ts) —
// checkbox selection is the only way to start a batch now, so a mis-click
// can't fire more than what's visibly ticked. The button itself is never
// disabled by "something is running" — the per-row spinner already says
// that; disabling the whole button on top would block starting a SECOND,
// unrelated batch while an earlier one finishes. It's disabled only when
// nothing is selected, since there is then nothing to do.
export function ShortlistPanel({ items }: { items: ShortlistItem[] }) {
  const { jobs, startJob } = useJobs();
  const router = useRouter();
  // stable "now" for freshness (per mount), same as the inbox
  const now = useMemo(() => Date.now(), []);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  const scoreByUrl = useMemo(() => {
    const best = new Map<string, (typeof jobs)[number]>();
    for (const j of jobs) {
      if (!j.input || j.kind !== "evaluate") continue;
      const ex = best.get(j.input);
      if (!ex || j.startedAt > ex.startedAt) best.set(j.input, j);
    }
    const m = new Map<string, RowScore>();
    for (const [url, j] of best) {
      m.set(url, { score: j.result?.score ?? null, tone: j.result?.tone ?? "muted", jobId: j.id, running: j.status === "running" });
    }
    return m;
  }, [jobs]);

  /** Leave the shortlist. `restore` sends the role back to the inbox (the
   *  bookmark toggle); without it the entry is simply gone (the ✗). */
  const leaveShortlist = async (url: string, restore: boolean) => {
    setBusy((s) => new Set(s).add(url));
    try {
      const res = await fetch("/api/pipeline/shortlist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, ...(restore ? { restore: true } : {}) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : restore ? "Couldn't move that back to the inbox." : "Couldn't remove that.");
    } finally {
      setBusy((s) => {
        const n = new Set(s);
        n.delete(url);
        return n;
      });
    }
  };

  // A shortlisted job that SUCCESSFULLY finishes evaluating now lives in the
  // tracker (EVALUATED tab) — drop it from here so it isn't shown in both
  // places. Plain removal, never `restore`: it has been scored, the inbox is
  // done with it.
  //
  // The `status === "done"` check is load-bearing, not defensive noise. Without
  // it, a FAILED evaluation removed the role from the shortlist permanently —
  // no report, no tracker row, no discard.log entry, nothing to notice. A
  // batch run against a broken CLI destroyed 65 shortlisted roles that way.
  // The job store no longer emits this event for failures either; this is the
  // second of two guards, deliberately, because losing a curated shortlist is
  // silent and unrecoverable from the UI.
  useEffect(() => {
    const onDone = (e: Event) => {
      const detail = (e as CustomEvent<{ kind?: string; input?: string; status?: string }>).detail;
      if (detail?.status && detail.status !== "done") return;
      if (detail?.kind === "evaluate" && detail.input && items.some((it) => it.url === detail.input)) {
        leaveShortlist(detail.input, false);
      }
    };
    window.addEventListener("co-job-done", onDone);
    return () => window.removeEventListener("co-job-done", onDone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const scoreOne = (it: ShortlistItem, batchId?: string) =>
    startJob({ title: `Score · ${it.company}`, subtitle: it.role, kind: "evaluate", input: it.url, page: "/pipeline", batchId });

  // Selection-only now — no implicit "nothing ticked means everything".
  const targets = items.filter((it) => selected.has(it.url));
  const scoreTargets = () => {
    if (targets.length === 0) return;
    const batchId = `shortlist-${Date.now()}`;
    for (const it of targets) {
      // Guards the rare case a row was checked and THEN started running from
      // elsewhere (e.g. its own row's Score button) before this fired — its
      // checkbox is disabled going forward (see selectDisabled below), but
      // this covers the instant in between.
      if (scoreByUrl.get(it.url)?.running) continue;
      scoreOne(it, batchId);
    }
    setSelected(new Set());
  };

  if (items.length === 0) {
    return (
      <div className="mt-6 rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-12 text-center text-sm text-muted">
        Nothing shortlisted yet. Save a role from the Inbox tab to build your shortlist here.
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          <span className="tabular-nums text-foreground">{items.length}</span> saved for scoring.
        </p>
        <button
          type="button"
          onClick={scoreTargets}
          disabled={selected.size === 0}
          title={selected.size === 0 ? "Select at least one role to score" : undefined}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand/90 disabled:opacity-50 max-sm:min-h-[44px]"
        >
          <Sparkles className="size-4" />
          Score selected{selected.size > 0 ? ` (${selected.size})` : ""}
        </button>
      </div>

      {error && (
        <p className="mt-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <ul className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface/40">
        {items.map((it) => {
          // TriageRow speaks InboxJob; a shortlist bullet now carries location
          // too (4th column), and postedAt is joined from scan-history by
          // pipelineSummary() exactly as it is for the inbox — so this stays a
          // shape adapter, and the card shows the same location/age/source the
          // inbox showed before the role was bookmarked.
          const job: InboxJob = {
            url: it.url,
            company: it.company,
            role: it.role,
            location: it.location,
            postedAt: it.postedAt,
            done: false,
          };
          const disabled = busy.has(it.url);
          const running = !!scoreByUrl.get(it.url)?.running;
          return (
            <TriageRow
              key={it.url}
              job={job}
              source={sourceFromUrl(it.url)}
              age={daysSince(it.postedAt, now)}
              scored={scoreByUrl.get(it.url)}
              selected={selected.has(it.url)}
              shortlisted
              selectDisabled={running}
              onToggleSelect={() =>
                setSelected((s) => {
                  const n = new Set(s);
                  if (n.has(it.url)) n.delete(it.url);
                  else n.add(it.url);
                  return n;
                })
              }
              onScore={() => scoreOne(it)}
              onSave={() => !disabled && leaveShortlist(it.url, true)}
              onSkip={() => !disabled && leaveShortlist(it.url, false)}
              onDelete={() => leaveShortlist(it.url, false)}
              labels={{
                save: "Shortlisted",
                saveTitle: "Un-shortlist — send this back to your inbox",
                skipTitle: "Delete — remove this role for good",
              }}
            />
          );
        })}
      </ul>
    </div>
  );
}
