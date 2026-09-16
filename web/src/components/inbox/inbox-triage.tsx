"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2, Sparkles, Loader2, Trash2 } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { ClearConfirmModal } from "@/components/clear-confirm-modal";
import type { InboxJob, ShortlistItem } from "@/lib/career-ops";
import type { AtsSource } from "@/lib/explore";
import { ALL_SOURCES } from "@/lib/explore";
import { daysSince, seniorityFromTitle, sourceFromUrl, SENIORITY_ORDER, type Seniority } from "@/lib/inbox";
import { FacetChips } from "./facet-chips";
import { TriageRow, type RowScore } from "./triage-row";
import { cn } from "@/lib/cn";

const HIDDEN_KEY = "career-ops:hidden";
// Triage runs whose discard review has already been dealt with (archived or
// cancelled). Kept in storage, not a ref: a ref dies with the component, so
// leaving the page and coming back re-surfaced an already-handled review.
const TRIAGE_HANDLED_KEY = "career-ops:triage-handled";
const BATCH = 20;

function readHandledTriageIds(): string[] {
  try {
    const raw = localStorage.getItem(TRIAGE_HANDLED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function markTriageHandled(id: string | null) {
  if (!id) return;
  try {
    // Bounded — only the most recent handful matter for the 20-minute window.
    localStorage.setItem(TRIAGE_HANDLED_KEY, JSON.stringify([id, ...readHandledTriageIds().filter((x) => x !== id)].slice(0, 20)));
  } catch {
    /* storage full/blocked — worst case a handled review resurfaces once */
  }
}

// The inbox as a TRIAGE surface: Abundance → Triage → Shortlist → Opt-in Score.
// Default is a small fresh batch (never the full wall); free facets + Save/Skip narrow
// it. Shortlisting hands off to the Shortlist tab (persistent, server-side —
// see data/pipeline.md's `## Shortlisted` section) rather than keeping its own
// copy here — this component only ever adds to or checks against that list.
// 🔴 The shell is agnostic to what makes a role relevant — order is freshness
// with a single documented plug point.
export function InboxTriage({ inbox, shortlist }: { inbox: InboxJob[]; shortlist: ShortlistItem[] }) {
  const { jobs, startJob } = useJobs();
  const router = useRouter();
  const [showClearModal, setShowClearModal] = useState(false);

  // facets
  const [within, setWithin] = useState<number | null>(null);
  const [sources, setSources] = useState<Set<AtsSource>>(() => new Set());
  const [seniorities, setSeniorities] = useState<Set<Seniority>>(() => new Set());
  const [locQ, setLocQ] = useState("");
  const [kw, setKw] = useState("");
  const [showAll, setShowAll] = useState(false);

  // ephemeral selection/undo — shortlist itself is now a prop (server state)
  const [hidden, setHidden] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [undo, setUndo] = useState<{ label: string; fn: () => void } | null>(null);
  // Ephemeral (not persisted) — real deletes, unlike `hidden` above which is a
  // localStorage-backed soft-hide. Kept separate so a delete never bleeds into
  // skip/hide semantics or its storage.
  const [deleted, setDeleted] = useState<Set<string>>(() => new Set());
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [bulkTriaging, setBulkTriaging] = useState(false);
  // Quick Triage review state — a batched classification result waiting for
  // the user to confirm before anything actually leaves the inbox. Keyed by
  // job URL. `null` = no review in progress (the normal, default state).
  const [triageFlags, setTriageFlags] = useState<Map<string, string> | null>(null);
  const [triageChecked, setTriageChecked] = useState<Set<string>>(() => new Set());
  const [triageWarning, setTriageWarning] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    try {
      const h = localStorage.getItem(HIDDEN_KEY);
      if (h) setHidden(JSON.parse(h));
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden)); } catch { /* quota */ }
  }, [hidden, loaded]);
  // auto-dismiss the undo toast
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 5000);
    return () => clearTimeout(t);
  }, [undo]);
  useEffect(() => {
    if (!deleteError) return;
    const t = setTimeout(() => setDeleteError(null), 5000);
    return () => clearTimeout(t);
  }, [deleteError]);

  // stable "now" for freshness (per mount)
  const now = useMemo(() => Date.now(), []);

  // Dedupe by URL — pipeline.md can list the same posting twice; it's one job, so it
  // triages once (and Save/Skip/score, all keyed by URL, act on it coherently).
  const enriched = useMemo(() => {
    const seen = new Set<string>();
    const out: { job: InboxJob; source: AtsSource | null; seniority: Seniority | null; age: number | null }[] = [];
    for (const job of inbox) {
      if (seen.has(job.url)) continue;
      seen.add(job.url);
      out.push({ job, source: sourceFromUrl(job.url), seniority: seniorityFromTitle(job.role), age: daysSince(job.postedAt, now) });
    }
    return out;
  }, [inbox, now]);

  // The flagged set, intersected with what the server still says is pending.
  // The review bar counts THIS, not `triageChecked` — a set the user already
  // archived is gone from `inbox` on the next server read, so the bar has
  // nothing left to offer and hides itself instead of insisting "1 flagged for
  // archive" at an inbox where that role no longer exists.
  const liveTriageChecked = useMemo(() => {
    if (!triageFlags) return [];
    const pending = new Set(inbox.map((j) => j.url));
    return [...triageChecked].filter((url) => pending.has(url));
  }, [triageFlags, triageChecked, inbox]);

  // EVALUADA lookup: the latest evaluate worker per posting URL (running → badge).
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

  // facet options — only surface what's actually present in the (non-hidden) data
  const availSources = useMemo(() => {
    const set = new Set<AtsSource>();
    for (const e of enriched) if (e.source && !hidden.includes(e.job.url)) set.add(e.source);
    return ALL_SOURCES.filter((s) => set.has(s));
  }, [enriched, hidden]);
  const availSeniorities = useMemo(() => {
    const set = new Set<Seniority>();
    for (const e of enriched) if (e.seniority && !hidden.includes(e.job.url)) set.add(e.seniority);
    return SENIORITY_ORDER.filter((s) => set.has(s));
  }, [enriched, hidden]);

  const filtered = useMemo(
    () =>
      enriched.filter((e) => {
        if (hidden.includes(e.job.url)) return false;
        if (deleted.has(e.job.url)) return false;
        if (within != null && (e.age == null || e.age > within)) return false;
        if (sources.size && (!e.source || !sources.has(e.source))) return false;
        if (seniorities.size && (!e.seniority || !seniorities.has(e.seniority))) return false;
        if (locQ.trim() && !(e.job.location || "").toLowerCase().includes(locQ.trim().toLowerCase())) return false;
        if (kw.trim() && !`${e.job.company} ${e.job.role}`.toLowerCase().includes(kw.trim().toLowerCase())) return false;
        return true;
      }),
    [enriched, hidden, deleted, within, sources, seniorities, locQ, kw],
  );

  // 🔴 SINGLE ORDER PLUG POINT — freshness only (newest first_seen first; unknown last).
  // A smarter ranker replaces ONLY this comparator; facets/triage/shortlist/score never
  // touch relevance. This is the whole firewall in one line.
  const ordered = useMemo(() => [...filtered].sort((a, b) => (a.age ?? Infinity) - (b.age ?? Infinity)), [filtered]);

  const anyFacet = within != null || sources.size > 0 || seniorities.size > 0 || locQ.trim() !== "" || kw.trim() !== "";
  const capped = !showAll && !anyFacet;
  const visible = capped ? ordered.slice(0, BATCH) : ordered;
  const hiddenCount = hidden.length;

  const isShortlisted = (url: string) => shortlist.some((s) => s.url === url);

  // Persists straight to data/pipeline.md's `## Shortlisted` section (see
  // shortlist-entries.mjs) — the Shortlist tab reads the same server state,
  // so router.refresh() is what actually shows the save, not local state here.
  const save = (job: InboxJob) => {
    if (isShortlisted(job.url)) return;
    fetch("/api/pipeline/shortlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: job.url, company: job.company, role: job.role, location: job.location }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Save failed");
        router.refresh();
      })
      .catch(() => setDeleteError(`Couldn't save ${job.company} to your shortlist — try again.`));
  };
  const skip = (job: InboxJob) => {
    setHidden((h) => (h.includes(job.url) ? h : [...h, job.url]));
    setUndo({ label: `Skipped ${job.company}`, fn: () => setHidden((h) => h.filter((u) => u !== job.url)) });
  };
  // Real, permanent delete (swipe gesture) — distinct from skip/hide above.
  // Optimistic: removed from view immediately, reverted if the API call fails.
  const deleteJob = async (job: InboxJob) => {
    setDeleted((d) => new Set(d).add(job.url));
    try {
      const res = await fetch("/api/pipeline", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: job.url }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Delete failed");
    } catch (err) {
      setDeleted((d) => {
        const n = new Set(d);
        n.delete(job.url);
        return n;
      });
      setDeleteError(err instanceof Error ? err.message : "Delete failed");
    }
  };
  const toggleSelect = (url: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(url)) n.delete(url);
      else n.add(url);
      return n;
    });
  const saveSelected = async () => {
    const add = enriched.filter((e) => selected.has(e.job.url) && !isShortlisted(e.job.url));
    setSelected(new Set());
    if (add.length === 0) return;
    // One batched request — the endpoint moves the whole set under a single
    // pipeline.md lock/write, rather than N requests racing for N locks.
    await fetch("/api/pipeline/shortlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: add.map((e) => ({ url: e.job.url, company: e.job.company, role: e.job.role, location: e.job.location })) }),
    }).catch(() => setDeleteError("Couldn't save those to your shortlist — try again."));
    router.refresh();
  };

  // Quick Triage — one batched classification call (see /api/triage) instead
  // of a per-job round trip. Nothing leaves the inbox from this alone: it
  // only proposes a discard set for review (pre-checked) — archiveChecked
  // below is the one thing that actually commits anything.
  // Ref mirrors of state the reconciliation poller below needs to read
  // without re-subscribing its effect on every keystroke/checkbox click.
  const triageFlagsRef = useRef(triageFlags);
  useEffect(() => { triageFlagsRef.current = triageFlags; }, [triageFlags]);
  const loadedTriageJobId = useRef<string | null>(null);
  // Current pending URLs, for the poller's closure (which has empty deps).
  const inboxUrlsRef = useRef<Set<string>>(new Set());
  useEffect(() => { inboxUrlsRef.current = new Set(inbox.map((j) => j.url)); }, [inbox]);

  /** Surface a finished triage run: kept roles have ALREADY been moved out of
   *  the inbox into the shortlist server-side (see /api/triage), so all that's
   *  left here is the discard set — pre-checked, awaiting review. `moved` is
   *  reported so a run that flags nothing still shows what it actually did. */
  const applyTriageDecisions = (decisions: unknown, moved?: number, fromRegistry = false) => {
    const flags = new Map<string, string>();
    if (Array.isArray(decisions)) {
      const pending = inboxUrlsRef.current;
      for (const r of decisions as Array<{ id?: string; decision?: string; reason?: string }>) {
        if (r?.decision !== "discard" || typeof r.id !== "string") continue;
        // A flag for a posting that is no longer pending is spent — it was
        // archived (or otherwise left the inbox) already. Dropping it here is
        // what stops a re-surfaced run from re-announcing work that's done.
        if (!pending.has(r.id)) continue;
        flags.set(r.id, r.reason || "Flagged by Quick Triage");
      }
    }
    const movedNote = moved != null && moved > 0 ? `Moved ${moved} to your shortlist.` : "";
    if (flags.size === 0) {
      // Re-surfaced from the registry with nothing left to act on: that run is
      // spent. Say nothing and remember it, so it stops coming back.
      if (fromRegistry) {
        markTriageHandled(loadedTriageJobId.current);
        return;
      }
      setTriageWarning(movedNote ? `${movedNote} Nothing needed archiving.` : "Nothing to do — these roles were already triaged.");
    } else {
      if (movedNote) setTriageWarning(`${movedNote} ${flags.size} flagged below — deselect any you want to keep.`);
      setTriageFlags(flags);
      setTriageChecked(new Set(flags.keys()));
    }
    // The kept roles just left the inbox — pull the fresh server snapshot so
    // the list below actually reflects that.
    router.refresh();
  };

  // Reconciles Quick Triage against the durable registry (GET /api/jobs) —
  // the same fix as the scoring/scan buttons, applied here too: a batch call
  // that outlives this component (tab closed, navigated away, connection
  // dropped mid-request) is not lost. Runs on mount and every few seconds so
  // "I went away and came back" shows the real state, not silence.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      let data: { jobs?: Array<{ id: string; kind: string; status: string; startedAt: number; endedAt?: number; data?: unknown }> };
      try {
        const res = await fetch("/api/jobs");
        if (!res.ok || cancelled) return;
        data = await res.json();
      } catch {
        return; // offline — next tick tries again
      }
      const latest = (data.jobs || []).find((j) => j.kind === "triage");
      if (!latest) return;
      if (latest.status === "running") {
        setBulkTriaging(true);
        return;
      }
      setBulkTriaging(false);
      if (loadedTriageJobId.current === latest.id) return; // already surfaced this one
      if (triageFlagsRef.current) return; // mid-review of an earlier batch — don't clobber it
      // Survives remount, unlike the ref alone: navigating away and back used
      // to rebuild this component with a fresh (null) ref, so the SAME
      // finished triage job got re-surfaced every time — "1 flagged for
      // archive" reappearing after it had already been archived.
      if (readHandledTriageIds().includes(latest.id)) return;
      const isRecent = Date.now() - (latest.endedAt ?? latest.startedAt) < 20 * 60_000;
      if (!isRecent) return;
      loadedTriageJobId.current = latest.id;
      applyTriageDecisions(latest.data, undefined, true);
    };
    check();
    const interval = setInterval(check, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const handleBulkTriage = async () => {
    setBulkTriaging(true);
    setTriageWarning(null);
    const targets = visible.filter((e) => !isShortlisted(e.job.url) && !hidden.includes(e.job.url) && !scoreByUrl.has(e.job.url));
    const id = `triage-${Date.now()}`;

    // Separated from response handling below on purpose: a network failure
    // here (dropped connection, backgrounded tab) does NOT mean the request
    // failed — /api/triage keeps running server-side and writes its outcome
    // to the durable registry regardless (see its own header), so the right
    // response is "keep waiting", not "show an error". A real 4xx/5xx
    // response, by contrast, means nothing was even registered — that IS a
    // definite, immediate failure, handled separately below.
    let res: Response;
    try {
      res = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          items: targets.map((e) => ({ id: e.job.url, company: e.job.company, role: e.job.role, location: e.job.location })),
        }),
      });
    } catch {
      setTriageWarning("Lost the connection while triaging — still checking in the background…");
      return; // deliberately leaves bulkTriaging=true; the poller resolves it
    }

    try {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Triage failed");
      loadedTriageJobId.current = id; // this response already surfaces it — the poller shouldn't re-announce it
      applyTriageDecisions(data.results, data.movedToShortlist);
      if (data.warnings?.length) setTriageWarning(`Triage finished, but with issues: ${data.warnings[0]}`);
    } catch (err) {
      setTriageWarning(err instanceof Error ? err.message : "Triage failed");
    } finally {
      setBulkTriaging(false);
    }
  };

  const toggleTriageChecked = (url: string) =>
    setTriageChecked((s) => {
      const n = new Set(s);
      if (n.has(url)) n.delete(url);
      else n.add(url);
      return n;
    });

  const dismissTriageReview = () => {
    markTriageHandled(loadedTriageJobId.current);
    setTriageFlags(null);
    setTriageChecked(new Set());
  };

  // The one action that actually removes anything from the inbox — for
  // real, via archive-pipeline-entries.mjs (data/pipeline.md + discard.log),
  // not a client-side hide. router.refresh() re-reads the server's inbox
  // snapshot afterward since these rows are now genuinely gone from it.
  const archiveChecked = async () => {
    if (!triageFlags || liveTriageChecked.length === 0) return;
    setArchiving(true);
    const items = liveTriageChecked.map((url) => ({ url, reason: triageFlags.get(url) || "pre-screen mismatch" }));
    try {
      const res = await fetch("/api/pipeline/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ items }),
      });
      // Read as TEXT first, then parse. res.json() on a non-JSON body throws a
      // parser error whose message says nothing useful about what went wrong —
      // on Safari, literally "The string did not match the expected pattern",
      // which is what this button reported in the wild. A non-JSON body here is
      // not hypothetical: reached over the Cloudflare tunnel, an expired Access
      // session answers with an HTML login page, and a request that outlives the
      // tunnel's timeout (this route holds the pipeline.md lock) answers with an
      // HTML error page. Both are 2 lines of HTML and a useless exception.
      const raw = await res.text();
      let data: { error?: string; archived?: string[]; notFound?: string[] } | null = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        /* handled below — keep the body for the message */
      }
      if (!res.ok || !data) {
        if (data?.error) throw new Error(data.error);
        const ct = res.headers.get("content-type") ?? "unknown";
        const looksLikeLogin = /<html/i.test(raw) && /(access|login|sign in)/i.test(raw);
        throw new Error(
          looksLikeLogin
            ? `Archive failed — the server returned a sign-in page (HTTP ${res.status}). Your Cloudflare Access session likely expired; reload and sign in again.`
            : `Archive failed (HTTP ${res.status}, ${ct})${raw ? `: ${raw.slice(0, 140)}` : ""}`,
        );
      }
      dismissTriageReview();
      router.refresh();
    } catch (err) {
      setTriageWarning(err instanceof Error ? err.message : "Archive failed");
    } finally {
      setArchiving(false);
    }
  };

  const scoreSingle = (job: InboxJob) => {
    startJob({ title: `Score · ${job.company}`, subtitle: job.role, kind: "evaluate", input: job.url, page: "/pipeline" });
  };

  // The parent (PipelineView) renders the rich empty-inbox card; here we always
  // have ≥1 raw posting.
  if (inbox.length === 0) return null;

  return (
    <div className="mx-auto mt-4 max-w-3xl">
      <FacetChips
        within={within}
        setWithin={setWithin}
        sources={sources}
        toggleSource={(s) => setSources((set) => { const n = new Set(set); n.has(s) ? n.delete(s) : n.add(s); return n; })}
        seniorities={seniorities}
        toggleSeniority={(s) => setSeniorities((set) => { const n = new Set(set); n.has(s) ? n.delete(s) : n.add(s); return n; })}
        locQ={locQ}
        setLocQ={setLocQ}
        kw={kw}
        setKw={setKw}
        availSources={availSources}
        availSeniorities={availSeniorities}
        resultCount={filtered.length}
        totalCount={enriched.length - hiddenCount}
        anyActive={anyFacet}
        onClear={() => { setWithin(null); setSources(new Set()); setSeniorities(new Set()); setLocQ(""); setKw(""); }}
      />

      {/* batch header: fresh slice by default, or the full filtered set */}
      <div className="mt-4 flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-foreground">
          {capped ? "Fresh — worth a look" : anyFacet ? `${filtered.length} match${filtered.length === 1 ? "" : "es"}` : "All roles"}
        </p>
        {hiddenCount > 0 && (
          <button type="button" onClick={() => setHidden([])} className="text-xs text-faint transition-colors hover:text-foreground">
            {hiddenCount} hidden · restore
          </button>
        )}
      </div>

      {/* bulk action bar — either the normal triage/multi-select controls, OR
          (once a batch has run) the discard review + Archive bar in their place */}
      {triageFlags && liveTriageChecked.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm">
          <span className="font-medium text-red-600 tabular-nums dark:text-red-400">
            {liveTriageChecked.length} flagged for archive
          </span>
          <button
            type="button"
            onClick={archiveChecked}
            disabled={archiving || liveTriageChecked.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50 max-sm:min-h-[44px]"
          >
            {archiving && <Loader2 className="size-3.5 animate-spin" />}
            Archive ({liveTriageChecked.length})
          </button>
          <button type="button" onClick={dismissTriageReview} disabled={archiving} className="text-xs text-muted hover:text-foreground max-sm:min-h-[44px]">
            Cancel — keep everything
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {visible.length > 0 && (
            <button
              type="button"
              onClick={handleBulkTriage}
              disabled={bulkTriaging}
              title="Flag obvious mismatches for review, using your strict deal-breakers — nothing leaves the inbox until you confirm"
              className="flex items-center gap-2 rounded-lg border border-brand/30 bg-brand-soft px-3 py-2 text-sm font-medium text-brand transition-colors hover:bg-brand/20 disabled:opacity-50"
            >
              {bulkTriaging ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {bulkTriaging ? "Triaging…" : `Quick Triage ${visible.filter((e) => !isShortlisted(e.job.url) && !scoreByUrl.has(e.job.url)).length}`}
            </button>
          )}

          {selected.size > 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-brand/30 bg-brand-soft px-3 py-2 text-sm">
              <span className="font-medium text-brand tabular-nums">{selected.size} selected</span>
              <button type="button" onClick={saveSelected} className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-brand-foreground max-sm:min-h-[44px]">
                Save to shortlist
              </button>
              <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-muted hover:text-foreground max-sm:min-h-[44px]">
                Clear
              </button>
            </div>
          )}
        </div>
      )}

      {triageWarning && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{triageWarning}</p>
      )}

      {visible.length > 0 ? (
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface/40">
          {visible.map((e) => (
            <TriageRow
              key={e.job.url}
              job={e.job}
              source={e.source}
              age={e.age}
              scored={scoreByUrl.get(e.job.url)}
              selected={selected.has(e.job.url)}
              shortlisted={isShortlisted(e.job.url)}
              onToggleSelect={() => toggleSelect(e.job.url)}
              onSave={() => save(e.job)}
              onSkip={() => skip(e.job)}
              onScore={() => scoreSingle(e.job)}
              onDelete={() => deleteJob(e.job)}
              triageReason={triageFlags?.get(e.job.url)}
              triageChecked={triageChecked.has(e.job.url)}
              onToggleTriage={() => toggleTriageChecked(e.job.url)}
            />
          ))}
        </ul>
      ) : (
        <div className="mt-3 rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-10 text-center">
          <p className="font-display text-lg">No matches</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">Loosen the filters to see more of your inbox.</p>
        </div>
      )}

      {/* "See all N" — only when the fresh batch is capping a larger list */}
      {capped && ordered.length > BATCH && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-xl border border-border bg-surface/40 py-2.5 text-sm font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand max-sm:min-h-[44px]"
        >
          See all {ordered.length} in inbox →
        </button>
      )}

      {/* empty-shortlist guidance (only once there's nothing saved) */}
      {shortlist.length === 0 && (
        <p className="mt-4 text-center text-xs text-faint">Save roles worth a look, then score them together from the Shortlist tab.</p>
      )}

      {enriched.length > 0 && (
        <button
          type="button"
          onClick={() => setShowClearModal(true)}
          className="mt-6 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-500/25 bg-red-500/5 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400 max-sm:min-h-[44px]"
        >
          <Trash2 className="size-4" /> Clear inbox
        </button>
      )}

      {showClearModal && (
        <ClearConfirmModal
          what="inbox"
          description="Permanently removes every pending role from your inbox and lets those same postings reappear on a future scan. This can't be undone."
          onConfirm={async () => {
            const res = await fetch("/api/pipeline/clear", { method: "POST" });
            if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to clear inbox");
            router.refresh();
          }}
          onClose={() => setShowClearModal(false)}
        />
      )}

      {deleteError && (
        <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-surface px-4 py-2 text-sm text-red-600 shadow-lg dark:text-red-400">
            {deleteError}
          </div>
        </div>
      )}

      {undo && (
        <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div className="inline-flex items-center gap-3 rounded-full border border-border bg-surface px-4 py-2 text-sm shadow-lg">
            <span className="text-muted">{undo.label}</span>
            <button type="button" onClick={() => { undo.fn(); setUndo(null); }} className="inline-flex items-center gap-1 font-medium text-brand max-sm:min-h-[44px]">
              <Undo2 className="size-3.5" /> Undo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
