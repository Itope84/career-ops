"use client";

import { useState } from "react";
import Link from "next/link";
import { Bookmark, BookmarkCheck, Loader2, X, Sparkles, ExternalLink } from "lucide-react";
import type { InboxJob } from "@/lib/career-ops";
import type { AtsSource } from "@/lib/explore";
import { ATS_LABEL } from "@/lib/explore";
import { Badge } from "@/components/ui/badge";
import { CompanyLogo } from "@/components/company-logo";
import { SwipeToDelete } from "@/components/swipe-to-delete";
import { cn } from "@/lib/cn";

export type RowScore = { score: number | null; tone: "good" | "warn" | "bad" | "muted"; jobId: string; running: boolean };

function agoLabel(age: number | null): string | null {
  if (age == null) return null;
  if (age <= 0) return "today";
  if (age === 1) return "yesterday";
  if (age < 7) return `${age}d ago`;
  if (age < 30) return `${Math.floor(age / 7)}w ago`;
  return `${Math.floor(age / 30)}mo ago`;
}

// One raw posting in the triage list. Shows ONLY cheap, free signals + an honest
// "not scored" (CRUDA) — never a fake match%. Once its shortlist eval finishes it
// flips to EVALUADA (a real A–F badge). Save→shortlist / Skip→hidden are free + undoable.
export function TriageRow({
  job,
  source,
  age,
  scored,
  selected,
  shortlisted,
  onToggleSelect,
  onSave,
  onSkip,
  onScore,
  onDelete,
  triageReason,
  triageChecked,
  onToggleTriage,
  labels,
  selectDisabled,
}: {
  job: InboxJob;
  source: AtsSource | null;
  age: number | null;
  scored?: RowScore;
  selected: boolean;
  shortlisted: boolean;
  onToggleSelect: () => void;
  onSave: () => void;
  onSkip: () => void;
  onScore: () => void;
  onDelete: () => void;
  /** Set when Quick Triage recommended discarding this posting — its reason,
   *  shown inline. Presence alone switches the row into "review a discard"
   *  mode: the checkbox means "will be archived" instead of "save to
   *  shortlist" until the batch is committed or dismissed. */
  triageReason?: string;
  triageChecked?: boolean;
  onToggleTriage?: () => void;
  /** The same three controls mean different things per surface — in the inbox
   *  the bookmark saves and ✗ hides; on the Shortlist tab the bookmark
   *  un-saves (back to the inbox) and ✗ deletes. Only the wording changes
   *  here; what the buttons DO is the caller's handlers. */
  labels?: { save?: string; saveTitle?: string; skipTitle?: string };
  /** Multi-select checkbox is non-interactive — used by the Shortlist tab
   *  while THIS row is already scoring, so it can't be added to a second,
   *  overlapping "Score selected" batch. Only affects the plain multi-select
   *  checkbox, never the Quick Triage one (`onToggleTriage`), which is a
   *  separate control with its own semantics. */
  selectDisabled?: boolean;
}) {
  const ago = agoLabel(age);
  const evaluated = !!scored && (scored.running || scored.score != null);
  const inTriageReview = triageReason != null;

  return (
    <li>
    <SwipeToDelete
      onDelete={onDelete}
      className={cn(
        "flex flex-col transition-colors",
        inTriageReview ? (triageChecked ? "bg-red-500/5" : "bg-surface") : selected ? "bg-brand-soft/50" : "hover:bg-surface-hover",
        evaluated && "opacity-95",
      )}
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5 sm:gap-3 sm:px-4">
      {/* multi-select — power-user batch to shortlist, OR (in a Quick Triage
          review) "will be archived" — same control, meaning depends on mode. */}
      <input
        type="checkbox"
        checked={inTriageReview ? !!triageChecked : selected}
        onChange={inTriageReview ? onToggleTriage : onToggleSelect}
        disabled={!inTriageReview && selectDisabled}
        aria-label={inTriageReview ? `Archive ${job.company} ${job.role}` : `Select ${job.company} ${job.role}`}
        title={!inTriageReview && selectDisabled ? "Already scoring — can't add it to another batch" : undefined}
        className={cn(
          "size-4 shrink-0 max-sm:min-h-[44px] max-sm:min-w-[24px]",
          inTriageReview ? "accent-red-500" : "accent-brand",
          !inTriageReview && selectDisabled && "cursor-not-allowed opacity-40",
        )}
      />

      <CompanyLogo name={job.company} size={20} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{job.company}</p>
        <p className="text-sm text-muted sm:truncate">{job.role}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
          {job.location && <span className="truncate">{job.location}</span>}
          {source && <span className="rounded bg-surface-hover px-1 py-px font-medium text-muted">{ATS_LABEL[source]}</span>}
          {ago && <span>{ago}</span>}
          {/* 🔴 CRUDA: honest "not scored" — no fabricated match%. */}
          {!evaluated && !inTriageReview && <span className="italic text-muted">not scored</span>}
        </p>
        {inTriageReview && (
          <p className={cn("mt-1 text-xs", triageChecked ? "text-red-600 dark:text-red-400" : "text-muted")}>
            {triageChecked ? `Flagged: ${triageReason}` : "Kept — deselected from the discard batch"}
          </p>
        )}
      </div>

      {/* EVALUADA state — compact badge, stays inline (not space-hungry like the 3 buttons) */}
      {evaluated && (
        <Link href={`/jobs/${scored!.jobId}`} className="flex shrink-0 items-center gap-1.5 text-xs">
          {scored!.running ? (
            <>
              <Loader2 className="size-3.5 animate-spin text-brand" />
              <span className="text-brand max-sm:hidden">Scoring…</span>
            </>
          ) : (
            <Badge tone={scored!.tone}>{scored!.score}/5</Badge>
          )}
        </Link>
      )}
      </div>

      {(job.url || !evaluated) && (
        <div className="flex items-center gap-1.5 border-t border-border/60 px-3 py-1.5 sm:px-4">
          {job.url ? (
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-[44px] flex-1 items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
            >
              <ExternalLink className="size-3.5" /> View posting
            </a>
          ) : (
            <div className="flex-1" />
          )}

          {!evaluated && (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={onScore}
                title="Score this job immediately"
                className="inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand-soft hover:text-brand min-h-[44px] min-w-[44px]"
              >
                <Sparkles className="size-4" />
                <span className="max-sm:hidden">Score</span>
              </button>
              <button
                type="button"
                onClick={onSave}
                title={labels?.saveTitle ?? (shortlisted ? "In your shortlist" : "Save to shortlist")}
                aria-pressed={shortlisted}
                className={cn(
                  "inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors min-h-[44px] min-w-[44px]",
                  shortlisted ? "text-brand" : "text-muted hover:bg-surface-hover hover:text-brand",
                )}
              >
                {shortlisted ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
                <span className="max-sm:hidden">{labels?.save ?? (shortlisted ? "Saved" : "Save")}</span>
              </button>
              <button
                type="button"
                onClick={onSkip}
                title={labels?.skipTitle ?? "Skip — hide from the inbox"}
                className="inline-flex items-center justify-center rounded-md p-1 text-faint transition-colors hover:bg-surface-hover hover:text-foreground min-h-[44px] min-w-[44px]"
              >
                <X className="size-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </SwipeToDelete>
    </li>
  );
}
