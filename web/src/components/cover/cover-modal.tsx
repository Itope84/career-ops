"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { mdComponents } from "@/components/markdown";
import { X, Sparkles, Loader2, FileText, Check, PenLine, RotateCcw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { useCover } from "@/components/cover/cover-provider";
import { CoverFieldRow } from "@/components/cover/cover-field-row";
import type { CoverField } from "@/lib/cover/types";

const STYLE = `
@keyframes co-cvrise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.co-cvrise{animation:co-cvrise .5s cubic-bezier(.22,1,.36,1) both}
@keyframes co-cvorb{0%,100%{transform:scale(1);opacity:.55}50%{transform:scale(1.3);opacity:.9}}
.co-cvorb{animation:co-cvorb 2.4s ease-in-out infinite}
@keyframes co-cvspin{to{transform:rotate(360deg)}}
.co-cvring{animation:co-cvspin 3s linear infinite}
@media (prefers-reduced-motion: reduce){.co-cvrise,.co-cvorb,.co-cvring{animation:none}}
`;

const THINKING_MSGS = [
  "Gathering requirements…",
  "Researching the company…",
  "Reading your CV in your own voice…",
  "Matching your wins to the role…",
  "Minting your cover letter…",
];

export function CoverModal() {
  const { modalOpen, close, status, error, company, current, result, submit, reset } = useCover();

  // Lock body scroll + close on Escape while the modal is open.
  useEffect(() => {
    if (!modalOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [modalOpen, close]);

  if (!modalOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 py-8 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <style>{STYLE}</style>
      <div className="relative flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl">
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-brand" />
            <h3 className="font-display text-lg text-foreground">
              Cover letter{company ? <span className="text-muted"> · {company}</span> : null}
            </h3>
          </div>
          <button onClick={close} className="text-muted transition-colors hover:text-foreground" aria-label="Close">
            <X className="size-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {status === "thinking" && <Thinking />}
          {status === "error" && <ErrorState message={error} onClose={close} onReset={reset} />}
          {status === "awaiting-input" && current?.phase === "collect" && (
            <CollectForm key={JSON.stringify(current.fields.map((f) => f.id))} envelope={current} onSubmit={submit} />
          )}
          {status === "review" && current?.phase === "review" && (
            <ReviewLetter letterMarkdown={current.letterMarkdown} note={current.note} onSubmit={submit} />
          )}
          {status === "done" && <DoneState result={result} onReset={reset} />}
        </div>
      </div>
    </div>
  );
}

function Thinking() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % THINKING_MSGS.length), 2600);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="co-cvrise flex flex-col items-center gap-4 py-12 text-center">
      <span className="relative grid size-16 place-items-center">
        <span className="co-cvorb absolute inset-0 rounded-full bg-brand/30 blur-lg" />
        <span className="co-cvring absolute inset-0 rounded-full border-2 border-brand/30 border-t-brand" />
        <Sparkles className="size-7 text-brand" />
      </span>
      <div key={i} className="co-cvrise text-sm text-muted">
        {THINKING_MSGS[i]}
      </div>
      <p className="max-w-xs text-xs text-faint">
        This runs your AI on your machine and can take a minute. You can close this — it keeps working, and
        you&apos;ll pick up right here.
      </p>
    </div>
  );
}

function CollectForm({ envelope, onSubmit }: { envelope: { title?: string; intro?: string; fields: CoverField[] }; onSubmit: (a: Record<string, string>) => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(envelope.fields.map((f) => [f.id, f.default ?? ""])),
  );
  const missing = useMemo(
    () => envelope.fields.filter((f) => f.required && !(answers[f.id] ?? "").trim()).map((f) => f.id),
    [envelope.fields, answers],
  );
  return (
    <div className="co-cvrise space-y-5">
      {envelope.title && <h4 className="font-display text-base text-landing">{envelope.title}</h4>}
      {envelope.intro && <p className="text-sm text-muted">{envelope.intro}</p>}
      {envelope.fields.map((f) => (
        <CoverFieldRow key={f.id} field={f} value={answers[f.id] ?? ""} onChange={(v) => setAnswers((p) => ({ ...p, [f.id]: v }))} />
      ))}
      <button
        onClick={() => onSubmit(answers)}
        disabled={missing.length > 0}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-2.5 font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50"
      >
        Continue
      </button>
    </div>
  );
}

function ReviewLetter({ letterMarkdown, note, onSubmit }: { letterMarkdown: string; note?: string; onSubmit: (a: Record<string, string>) => void }) {
  const [revising, setRevising] = useState(false);
  const [changes, setChanges] = useState("");
  const [regenerateCV, setRegenerateCV] = useState(false);
  return (
    <div className="co-cvrise space-y-4">
      <p className="text-sm text-muted">Here&apos;s your draft. Approve it to render the PDF, or tell me what to change.</p>
      <article className="report-prose max-h-[45vh] overflow-y-auto rounded-xl border border-border bg-surface/40 px-4 py-3 text-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{letterMarkdown}</ReactMarkdown>
      </article>
      {note && <p className="text-xs text-faint">{note}</p>}
      {revising ? (
        <div className="space-y-2">
          <textarea
            autoFocus
            rows={3}
            value={changes}
            onChange={(e) => setChanges(e.target.value)}
            placeholder="e.g. Make the opening punchier, drop the third bullet, warmer tone…"
            className="w-full resize-y rounded-xl border border-border bg-surface/60 px-3.5 py-2.5 text-sm outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
          />
          <div className="flex gap-2">
            <button
              onClick={() => onSubmit({ decision: "revise", changes })}
              disabled={!changes.trim()}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand py-2.5 font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50"
            >
              <PenLine className="size-4" /> Send changes
            </button>
            <button onClick={() => setRevising(false)} className="rounded-xl border border-border px-4 text-sm text-muted transition-colors hover:text-foreground">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-muted transition-colors hover:text-foreground">
            <input
              type="checkbox"
              checked={regenerateCV}
              onChange={(e) => setRegenerateCV(e.target.checked)}
              className="size-4 rounded border-border bg-surface/50 text-brand focus:ring-brand/20"
            />
            Also tailor my CV for this role
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => onSubmit({ decision: "approve", regenerateCV: regenerateCV ? "true" : "false" })}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand py-2.5 font-medium text-brand-foreground transition-colors hover:bg-brand-200"
            >
              <Check className="size-4" /> Approve & generate PDF
            </button>
            <button
              onClick={() => setRevising(true)}
              className="flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand"
            >
              <PenLine className="size-4" /> Request changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DoneState({ result, onReset }: { result: { letterMarkdown?: string; pdfPath?: string; cvPdfPath?: string; note?: string } | null; onReset: () => void }) {
  return (
    <div className="co-cvrise space-y-4 text-center">
      <span className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        <Check className="size-7" />
      </span>
      <h4 className="font-display text-xl text-landing">Ready</h4>
      {result?.pdfPath || result?.cvPdfPath ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {result?.pdfPath && (
            <a
              href={`/api/cover-pdf?path=${encodeURIComponent(result.pdfPath)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-500/15 dark:text-emerald-400"
            >
              <FileText className="size-4" /> Cover Letter
            </a>
          )}
          {result?.cvPdfPath && (
            <a
              href={`/api/cover-pdf?path=${encodeURIComponent(result.cvPdfPath)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-500/40 bg-blue-500/10 px-4 py-2.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-500/15 dark:text-blue-400"
            >
              <FileText className="size-4" /> Tailored CV
            </a>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">The letter is drafted below — regenerate the last step if you need the PDF file.</p>
      )}
      {result?.note && <p className="text-xs text-faint">{result.note}</p>}
      {result?.letterMarkdown && (
        <article className="report-prose max-h-[35vh] overflow-y-auto rounded-xl border border-border bg-surface/40 px-4 py-3 text-left text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{result.letterMarkdown}</ReactMarkdown>
        </article>
      )}
      <button onClick={onReset} className="inline-flex items-center gap-1.5 text-xs text-faint transition-colors hover:text-foreground">
        <RotateCcw className="size-3" /> Start another
      </button>
    </div>
  );
}

function ErrorState({ message, onClose, onReset }: { message: string; onClose: () => void; onReset: () => void }) {
  return (
    <div className="co-cvrise space-y-4 py-4">
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3.5">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <p className="text-sm text-amber-800 dark:text-amber-300">{message || "Something went wrong."}</p>
      </div>
      <div className="flex gap-2">
        <button onClick={onReset} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand py-2.5 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200">
          <Loader2 className="size-4" /> Start over
        </button>
        <button onClick={onClose} className="rounded-xl border border-border px-4 text-sm text-muted transition-colors hover:text-foreground">
          Close
        </button>
      </div>
    </div>
  );
}
