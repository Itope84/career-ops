"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { mdComponents } from "@/components/markdown";
import { ArrowLeft, Loader2, Wrench, CircleDot, Check, X, FileClock, ChevronDown } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { HeroGlow } from "@/components/hero-glow";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

type RegistryJobShape = {
  id: string;
  title: string;
  subtitle?: string;
  status: string;
  error?: string;
  result?: { score: number | null; reason?: string };
  opencodeSessionId?: string;
};

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { jobs, debugEnabled } = useJobs();
  const localJob = jobs.find((j) => j.id === id);

  // This tab may never have adopted this job at all — it could have finished
  // (or failed) while nothing was open to watch it, or the local job list
  // simply aged it out. Fall back to the durable registry directly rather
  // than declaring the job gone: the same gap the /jobs list page closed for
  // its listing applies here too, and it's worse on a detail page — this is
  // the one place someone lands specifically to find out what happened.
  const [registryJob, setRegistryJob] = useState<RegistryJobShape | null>(null);
  useEffect(() => {
    if (localJob) return;
    let cancelled = false;
    fetch("/api/jobs")
      .then((r) => r.json())
      .then((d: { jobs?: RegistryJobShape[] }) => {
        if (cancelled) return;
        setRegistryJob(d.jobs?.find((j) => j.id === id) ?? null);
      })
      .catch(() => {
        /* offline — falls through to the "not found" state below */
      });
    return () => {
      cancelled = true;
    };
  }, [id, localJob]);

  // No dedicated error field on Job — the reason lives as the last step's
  // label. Surfaced explicitly here since the step list itself is hidden
  // without DEBUG_ENABLED.
  const failureReason = localJob?.status === "error" ? localJob.steps[localJob.steps.length - 1]?.label : registryJob?.error;
  const opencodeSessionId = localJob?.opencodeSessionId ?? registryJob?.opencodeSessionId;

  if (!localJob && !registryJob) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link href="/pipeline" className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-brand">
          <ArrowLeft className="size-4" /> Pipeline
        </Link>
        <p className="mt-8 text-sm text-muted">
          This worker is no longer in memory, and the durable registry doesn&apos;t have it either — it finished more than a few
          hundred runs ago, or the id is wrong.
        </p>
      </div>
    );
  }

  // Normalize both sources down to what the page actually renders, so
  // everything below reads the same regardless of which one this came from.
  const title = localJob?.title ?? registryJob?.title ?? "Untitled";
  const subtitle = localJob?.subtitle ?? registryJob?.subtitle;
  const status = localJob?.status ?? (registryJob?.status === "queued" ? "running" : (registryJob?.status as "running" | "done" | "error"));
  const result = localJob?.result ?? (registryJob?.result?.score != null ? { score: registryJob.result.score, summary: registryJob.result.reason ?? "", tone: "muted" as const } : undefined);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/pipeline" className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-brand">
        <ArrowLeft className="size-4" /> Pipeline
      </Link>

      <section className="dot-bg relative mt-5 overflow-hidden rounded-2xl border border-border bg-surface/40 px-6 py-7">
        {status === "running" && <HeroGlow />}
        <div className="relative z-10">
          <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-faint">
            {status === "running" ? (
              <><Loader2 className="size-3 animate-spin text-brand" /> working</>
            ) : status === "done" ? (
              <><Check className="size-3 text-emerald-500" /> done</>
            ) : (
              <><X className="size-3 text-red-400" /> error</>
            )}
          </p>
          <h1 className="mt-2 font-display text-2xl tracking-tight text-landing">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          {result?.score != null && (
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <Badge tone={result.tone}>{result.score}/5</Badge>
              {result.summary && <span className="text-sm text-muted">{result.summary}</span>}
            </div>
          )}
          {failureReason && <p className="mt-3 text-sm text-red-500 dark:text-red-400">{failureReason}</p>}
          {!localJob && registryJob && (
            <p className="mt-3 text-xs italic text-faint">from an earlier session — no live transcript captured by this tab</p>
          )}
        </div>
      </section>

      {debugEnabled ? (
        <>
          {localJob && (
            <ol className="mt-6 space-y-2">
              {localJob.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm">
                  {s.kind === "tool" ? (
                    <Wrench className="mt-0.5 size-3.5 shrink-0 text-brand" />
                  ) : (
                    <CircleDot className="mt-0.5 size-3.5 shrink-0 text-faint" />
                  )}
                  <span className={s.kind === "tool" ? "font-medium" : "text-muted"}>
                    {s.kind === "tool" ? `Using ${s.label}` : s.label}
                  </span>
                </li>
              ))}
              {localJob.status === "running" && (
                <li className="flex items-center gap-2.5 text-sm text-muted">
                  <Loader2 className="size-3.5 animate-spin text-brand" /> thinking…
                </li>
              )}
            </ol>
          )}

          {localJob?.text && (
            <div className="mt-8">
              <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Output</h2>
              <div className="report-prose mt-3 rounded-2xl border border-border bg-surface/40 p-5">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{localJob.text}</ReactMarkdown>
              </div>
            </div>
          )}

          {/* opencode keeps a full, permanent transcript of every session it
              runs — every message, reasoning block and tool call — completely
              independent of whatever this tab happened to see live. This is
              the ONLY place that transcript still exists once the run is over
              and this tab's own capture (a rolling 4000-char tail, kept only
              in memory for one request) is long gone. Opencode-only: no other
              CLI has anything equivalent, so this section simply doesn't
              render for the rest. */}
          {opencodeSessionId && <OpencodeTranscript sessionId={opencodeSessionId} />}
        </>
      ) : (
        status === "running" && (
          <p className="mt-6 flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-3.5 animate-spin text-brand" /> Still running…
          </p>
        )
      )}
    </div>
  );
}

type TranscriptPart = { type: string; text?: string; tool?: string; state?: { status?: string; input?: { command?: string }; output?: string; error?: string }; [k: string]: unknown };
type TranscriptMessage = { id: string; role: string; createdAt: number; parts: TranscriptPart[] };

/** Loaded on click, not automatically — this shells out to sqlite3 against
 *  opencode's own database, which is cheap but has no reason to run just
 *  because someone opened the page. */
function OpencodeTranscript({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<TranscriptMessage[] | null>(null);

  const load = () => {
    setOpen(true);
    if (messages || loading) return;
    setLoading(true);
    setError(null);
    fetch(`/api/jobs/opencode-transcript?sessionId=${encodeURIComponent(sessionId)}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Failed to load transcript");
        setMessages(d.messages ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load transcript"))
      .finally(() => setLoading(false));
  };

  return (
    <div className="mt-8">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : load())}
        className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition-colors hover:text-foreground"
      >
        <FileClock className="size-3.5" /> Full opencode transcript
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="report-prose mt-3 space-y-4 rounded-2xl border border-border bg-surface/40 p-5">
          {loading && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="size-3.5 animate-spin" /> Reading opencode&apos;s session log…
            </p>
          )}
          {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
          {messages?.length === 0 && <p className="text-sm text-muted">Nothing recorded for this session.</p>}
          {messages?.map((m) => (
            <div key={m.id} className="border-l-2 border-border pl-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">{m.role}</p>
              <div className="mt-1.5 space-y-2.5">
                {m.parts.map((p, i) => <TranscriptPartView key={i} part={p} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TranscriptPartView({ part }: { part: TranscriptPart }) {
  if (part.type === "text" && typeof part.text === "string") {
    return <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{part.text}</ReactMarkdown>;
  }
  if (part.type === "reasoning" && typeof part.text === "string") {
    return <p className="text-sm italic text-muted">{part.text}</p>;
  }
  if (part.type === "tool") {
    const cmd = part.state?.input?.command;
    const output = part.state?.output;
    const err = part.state?.error;
    return (
      <div className="rounded-lg border border-border/60 bg-surface-hover/40 p-3 text-xs">
        <p className="flex items-center gap-1.5 font-medium text-brand">
          <Wrench className="size-3 shrink-0" /> {part.tool}
          {part.state?.status && <span className="text-faint">· {part.state.status}</span>}
        </p>
        {cmd && <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap text-faint">{cmd}</pre>}
        {output && <pre className="mt-1.5 max-h-64 overflow-y-auto overflow-x-auto whitespace-pre-wrap text-muted">{output.slice(0, 4000)}</pre>}
        {err && <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap text-red-500 dark:text-red-400">{err}</pre>}
      </div>
    );
  }
  // step-start / step-finish / anything else — internal bookkeeping, not
  // worth rendering as a visible line.
  return null;
}
