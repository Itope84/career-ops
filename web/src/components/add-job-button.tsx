"use client";

import { useState } from "react";
import { Plus, X, Loader2, Link as LinkIcon, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/cn";

export function AddJobButton() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() })
      });
      if (res.ok) {
        setSuccess(true);
        setTimeout(() => {
          setSuccess(false);
          setOpen(false);
          setUrl("");
        }, 1500);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+4rem)] right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-lg transition-transform hover:scale-105 active:scale-95 sm:bottom-24 sm:right-8"
        aria-label="Add job to pipeline"
      >
        <Plus className="size-6" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-xl relative animate-in fade-in zoom-in-95 duration-200">
            <button
              onClick={() => setOpen(false)}
              className="absolute right-4 top-4 text-muted hover:text-foreground"
            >
              <X className="size-5" />
            </button>
            <h3 className="mb-1 font-display text-xl text-foreground">Add to Pipeline</h3>
            <p className="mb-5 text-sm text-muted">Paste a job posting URL to add it to your Inbox.</p>

            <form onSubmit={submit} className="space-y-4">
              <div className="relative">
                <LinkIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <input
                  autoFocus
                  type="url"
                  required
                  placeholder="https://..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full rounded-xl border border-border bg-surface-hover py-2.5 pl-9 pr-3 text-sm outline-none transition-colors focus:border-brand/50 focus:ring-1 focus:ring-brand/50"
                />
              </div>
              <button
                type="submit"
                disabled={submitting || success}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-2.5 font-medium text-brand-foreground hover:bg-brand-200 disabled:opacity-70 transition-colors"
              >
                {submitting ? <Loader2 className="size-4 animate-spin" /> : success ? <CheckCircle2 className="size-4" /> : null}
                {success ? "Added!" : submitting ? "Adding..." : "Add to Inbox"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
