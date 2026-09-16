"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, ChevronsUpDown, X, Compass, ArrowRight, ExternalLink, Trash2 } from "lucide-react";
import { ClearConfirmModal } from "@/components/clear-confirm-modal";
import type { Application, InboxJob, ShortlistItem } from "@/lib/career-ops";
import { Badge } from "@/components/ui/badge";
import { CompanyLogo } from "@/components/company-logo";
import { canonStatus, scoreNum, scoreTone, statusDot } from "@/lib/format";
import { InboxTriage } from "@/components/inbox/inbox-triage";
import { ShortlistPanel } from "@/components/pipeline/shortlist-panel";
import { ScanButton } from "@/components/scan-button";
import { BroadSearchButton } from "@/components/broad-search-button";
import { ScanAtsFullButton } from "@/components/scan-ats-full-button";
import { cn } from "@/lib/cn";

// INBOX and SHORTLIST are triage surfaces (raw postings, not tracker rows);
// the rest filter the tracker. SHORTLIST replaces the old ALL tab, which was
// just every tracker row with no filter — redundant with the status tabs
// already sitting next to it.
const TABS = [
  "INBOX",
  "SHORTLIST",
  "EVALUATED",
  "APPLIED",
  "RESPONDED",
  "INTERVIEW",
  "OFFER",
  "REJECTED",
  "DISCARDED",
  "SKIP",
] as const;
type Tab = (typeof TABS)[number];

const SORT_KEYS = ["company", "role", "score", "status", "date"] as const;
type SortKey = (typeof SORT_KEYS)[number];

export function PipelineView({
  applications,
  inbox,
  shortlist,
}: {
  applications: Application[];
  inbox: InboxJob[];
  shortlist: ShortlistItem[];
}) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // The URL is the SINGLE source of truth for tab/min/sort/dir, so the home stat
  // tiles' deep links AND the assistant's filterPipeline/navigate actions drive
  // the table identically (no useState mirror → no desync).
  const pTab = (params.get("tab") ?? "").toUpperCase();
  const tab: Tab = (TABS as readonly string[]).includes(pTab) ? (pTab as Tab) : "INBOX";
  const pMin = parseFloat(params.get("min") ?? "");
  const minFilter: number | null = Number.isFinite(pMin) ? pMin : null;
  const pSort = params.get("sort") ?? "";
  const sortKey: SortKey = (SORT_KEYS as readonly string[]).includes(pSort) ? (pSort as SortKey) : "score";
  const sort = { key: sortKey, dir: (params.get("dir") === "1" ? 1 : -1) as 1 | -1 };

  // Search stays LOCAL for snappy typing; seeded from the URL and re-synced only
  // when the URL's q changes (i.e. the assistant set it) — never per keystroke.
  const [q, setQ] = useState(params.get("q") ?? "");
  const lastUrlQ = useRef(params.get("q") ?? "");
  useEffect(() => {
    const urlQ = params.get("q") ?? "";
    if (urlQ !== lastUrlQ.current) {
      lastUrlQ.current = urlQ;
      setQ(urlQ);
    }
  }, [params]);

  const setParams = useCallback(
    (updates: Record<string, string | number | null>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v == null || v === "") sp.delete(k);
        else sp.set(k, String(v));
      }
      const qs = sp.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [params, router, pathname],
  );

  // Pending + deduped by URL (pipeline.md can list the same posting twice) so the
  // header count, the tab count and the triage list all agree on one number.
  const pendingInbox = useMemo(() => {
    const seen = new Set<string>();
    const out: InboxJob[] = [];
    for (const j of inbox) {
      if (j.done || seen.has(j.url)) continue;
      seen.add(j.url);
      out.push(j);
    }
    return out;
  }, [inbox]);

  const filtered = useMemo(() => {
    if (tab === "INBOX" || tab === "SHORTLIST") return [];
    let rows = applications.filter((r) => canonStatus(r.status).includes(tab));
    if (minFilter != null) {
      rows = rows.filter((r) => {
        const n = scoreNum(r.score);
        return !Number.isNaN(n) && n >= minFilter;
      });
    }
    if (q.trim()) {
      const needle = q.toLowerCase();
      rows = rows.filter((r) => `${r.company} ${r.role}`.toLowerCase().includes(needle));
    }
    return [...rows].sort((a, b) => {
      if (sort.key === "score") {
        const an = scoreNum(a.score);
        const bn = scoreNum(b.score);
        const av = Number.isNaN(an) ? -Infinity : an;
        const bv = Number.isNaN(bn) ? -Infinity : bn;
        return (av - bv) * sort.dir;
      }
      return (a[sort.key] || "").localeCompare(b[sort.key] || "") * sort.dir;
    });
  }, [applications, tab, q, sort, minFilter]);

  const evaluatedCount = useMemo(() => applications.filter((a) => canonStatus(a.status) === "EVALUATED").length, [applications]);
  const [showClearEvaluated, setShowClearEvaluated] = useState(false);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 max-sm:pb-24 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-landing">Pipeline</h1>
          <p className="mt-1 text-sm text-muted">
            <span className="tabular-nums">{pendingInbox.length}</span> in inbox ·{" "}
            <span className="tabular-nums">{applications.length}</span> tracked
          </p>
        </div>
        {/* the tracker has its own search; the inbox brings its own facet filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {tab !== "INBOX" && tab !== "SHORTLIST" && (
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search company or role…"
                className="w-full rounded-md border border-border bg-surface/60 py-2 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-faint focus:border-brand/50 focus-visible:ring-2 focus-visible:ring-brand/40"
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <ScanButton />
            <ScanAtsFullButton />
            <BroadSearchButton />
          </div>
        </div>
      </div>

      {/* tabs — one scrollable row on phones (edge-bled), wrapping on larger screens */}
      <div className="no-scrollbar -mx-4 mt-6 flex gap-1 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:flex-wrap sm:overflow-x-visible sm:px-0">
        {TABS.map((t) => {
          const count =
            t === "INBOX"
              ? pendingInbox.length
              : t === "SHORTLIST"
                ? shortlist.length
                : applications.filter((r) => canonStatus(r.status).includes(t)).length;
          return (
            <button
              key={t}
              onClick={() => setParams({ tab: t === "INBOX" ? null : t })}
              className={cn(
                "-mb-px inline-flex shrink-0 items-center justify-center whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition-colors max-sm:min-h-[44px]",
                tab === t
                  ? "border-brand text-foreground"
                  : "border-transparent text-muted hover:text-foreground",
              )}
            >
              {t} <span className="ml-1 text-faint tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>

      {tab !== "INBOX" && tab !== "SHORTLIST" && minFilter != null && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-faint">Filtered:</span>
          <button
            type="button"
            onClick={() => setParams({ min: null })}
            className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand/15"
            title="Clear score filter"
          >
            score ≥ {minFilter.toFixed(1)}
            <X className="size-3" />
          </button>
        </div>
      )}

      {tab === "INBOX" ? (
        /* ── Inbox: the triage surface (Abundance → Triage → Shortlist → Score) ── */
        pendingInbox.length > 0 ? (
          <InboxTriage inbox={pendingInbox} shortlist={shortlist} />
        ) : (
          <InboxEmpty count={0} filtered={false} />
        )
      ) : tab === "SHORTLIST" ? (
        <ShortlistPanel items={shortlist} />
      ) : filtered.length > 0 ? (
        <>
          {/* ── Mobile: sort control + card list (the table can't earn its width on a phone) ── */}
          <div className="mt-4 flex items-center gap-2 sm:hidden">
            <label htmlFor="pipeline-sort" className="text-xs text-faint">
              Sort by
            </label>
            <select
              id="pipeline-sort"
              value={sort.key}
              onChange={(e) => setParams({ sort: e.target.value, dir: null })}
              className="min-h-[40px] rounded-md border border-border bg-surface/60 px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-brand/50"
            >
              {SORT_KEYS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setParams({ dir: sort.dir === -1 ? 1 : null })}
              aria-label={sort.dir === -1 ? "Sorted descending — switch to ascending" : "Sorted ascending — switch to descending"}
              className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-md border border-border bg-surface/60 text-sm text-muted transition-colors hover:text-foreground"
            >
              {sort.dir === -1 ? "↓" : "↑"}
            </button>
          </div>
          <ul className="mt-3 overflow-hidden rounded-2xl border border-border sm:hidden">
            {filtered.map((r, i) => (
              <li key={`${r.n}-${i}`} className={cn(i > 0 && "border-t border-border")}>
                <Link href={`/pipeline/${r.n}`} className="flex items-start gap-3 px-4 py-3 transition-colors active:bg-surface/60">
                  <span className="mt-0.5 shrink-0">
                    <CompanyLogo name={r.company} size={28} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{r.company}</span>
                      <Badge tone={scoreTone(r.score)}>{r.score || "—"}</Badge>
                    </span>
                    <span className="mt-0.5 block text-sm text-muted">{r.role}</span>
                    <span className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
                      <span className={cn("size-1.5 shrink-0 rounded-full", statusDot(r.status))} />
                      <span className="truncate">{r.status}</span>
                      <span className="ml-auto shrink-0 tabular-nums text-faint">{r.date}</span>
                    </span>
                  </span>
                </Link>
                {r.url && (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 border-t border-border/60 px-4 py-2 text-xs font-medium text-muted transition-colors active:bg-surface/60 min-h-[44px]"
                  >
                    <ExternalLink className="size-3.5" /> View posting
                  </a>
                )}
              </li>
            ))}
          </ul>

          {/* ── Tracker table (sm+) ── */}
        <div className="mt-4 overflow-hidden rounded-2xl border border-border max-sm:hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface/60 text-left text-xs uppercase tracking-wide text-faint">
              <tr>
                {SORT_KEYS.map((k) => (
                  <th
                    key={k}
                    className="cursor-pointer select-none px-4 py-2.5 font-medium hover:text-foreground"
                    onClick={() => setParams({ sort: k, dir: sort.key === k ? sort.dir * -1 : -1 })}
                  >
                    <span className="inline-flex items-center gap-1">
                      {k}
                      <ChevronsUpDown className="size-3" />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r, i) => (
                <tr key={`${r.n}-${i}`} className="group transition-colors hover:bg-surface/40">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/pipeline/${r.n}`} className="flex items-center gap-2.5 transition-colors group-hover:text-brand">
                      <CompanyLogo name={r.company} size={20} />
                      {r.company}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <Link href={`/pipeline/${r.n}`}>{r.role}</Link>
                      {r.url && (
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="View posting"
                          aria-label="View posting"
                          className="text-faint transition-colors hover:text-foreground"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={scoreTone(r.score)}>{r.score || "—"}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={cn("size-1.5 shrink-0 rounded-full", statusDot(r.status))} />
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-faint tabular-nums">{r.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-12 text-center">
          <p className="font-display text-lg">No matches</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">Try a different tab or clear the search.</p>
        </div>
      )}

      {tab === "EVALUATED" && evaluatedCount > 0 && (
        <button
          type="button"
          onClick={() => setShowClearEvaluated(true)}
          className="mt-6 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-500/25 bg-red-500/5 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400 max-sm:min-h-[44px]"
        >
          <Trash2 className="size-4" /> Clear evaluated
        </button>
      )}

      {showClearEvaluated && (
        <ClearConfirmModal
          what="evaluated"
          description={`Permanently deletes all ${evaluatedCount} row${evaluatedCount === 1 ? "" : "s"} with status "Evaluated" — plus their report files and any tailored CV PDFs. Applied, Interview, Offer, Rejected, and other statuses are never touched. This can't be undone.`}
          onConfirm={async () => {
            const res = await fetch("/api/applications/clear-evaluated", { method: "POST" });
            if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to clear evaluated rows");
            router.refresh();
          }}
          onClose={() => setShowClearEvaluated(false)}
        />
      )}
    </div>
  );
}

// Empty inbox. Self-sufficient for the mainstream user (a primary in-web action),
// honest for devs (the CLI/file path stays, demoted to progressive transparency).
function InboxEmpty({ count, filtered }: { count: number; filtered: boolean }) {
  if (filtered) {
    return (
      <div className="mt-4 rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-12 text-center">
        <p className="font-display text-lg">No matches</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">Clear the search to see the full inbox.</p>
      </div>
    );
  }
  return (
    <div className="dot-bg mt-4 overflow-hidden rounded-2xl border border-border bg-surface/50 bg-origin-border bg-gradient-to-tr from-brand/10 via-transparent to-transparent shadow-lg">
      <div className="flex items-center gap-2 border-b border-foreground/10 px-5 py-3">
        <span className="size-2.5 rounded-full bg-foreground/15" aria-hidden="true" />
        <span className="size-2.5 rounded-full bg-foreground/15" aria-hidden="true" />
        <span className="size-2.5 rounded-full bg-foreground/15" aria-hidden="true" />
        <span className="ml-3 font-mono text-xs tracking-wide text-muted">career-ops · inbox</span>
      </div>
      <div className="px-6 py-10 text-center">
        <p className="font-display text-lg">
          Your <span className="text-brand">inbox</span> is empty.
        </p>
        {count > 0 ? (
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">Nothing pending right now.</p>
        ) : (
          <>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted">Find roles that match your CV — free, no tokens spent.</p>
            <Link
              href="/explore?run=1"
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground shadow-sm transition-all duration-200 hover:bg-brand-200 hover:-translate-y-0.5 hover:shadow-md"
            >
              <Compass className="size-4" /> Run your first free scan <ArrowRight className="size-4" />
            </Link>
            <p className="mx-auto mt-4 max-w-sm text-xs text-muted">
              Prefer the terminal? Run <code className="rounded bg-surface-hover px-1 py-0.5 font-mono">career-ops scan</code>, or add job URLs to{" "}
              <code className="rounded bg-surface-hover px-1 py-0.5 font-mono">data/pipeline.md</code>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
