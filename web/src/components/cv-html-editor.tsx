"use client";

import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Loader2, FileText, Save } from "lucide-react";
import { cn } from "@/lib/cn";

export function CvHtmlEditor() {
  const searchParams = useSearchParams();
  const company = searchParams.get("company") ?? "";
  
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [exists, setExists] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pdfReady, setPdfReady] = useState(false);

  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!company) {
      setLoaded(true);
      setExists(false);
      return;
    }
    fetch(`/api/cv-html?company=${encodeURIComponent(company)}`)
      .then((r) => r.json())
      .then((d) => {
        setContent(d.content ?? "");
        setExists(d.exists ?? false);
      })
      .finally(() => setLoaded(true));
  }, [company]);

  async function save() {
    if (!editorRef.current) return;
    const newContent = editorRef.current.innerHTML;
    setSaving(true);
    try {
      const res = await fetch(`/api/cv-html?company=${encodeURIComponent(company)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newContent }),
      });
      if (res.ok) {
        setContent(newContent);
        setDirty(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  }

  async function generatePdf() {
    // save first if dirty
    if (dirty) await save();
    setGenerating(true);
    try {
      const res = await fetch(`/api/cv-html/generate-pdf?company=${encodeURIComponent(company)}`, {
        method: "POST",
      });
      if (res.ok) {
        setPdfReady(true);
      } else {
        alert("Failed to generate PDF");
      }
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-landing">Review Tailored CV</h1>
          <p className="mt-1 text-sm text-muted">
            Edit the generated CV for {company || "this role"}. 
            {!exists && loaded && <span className="ml-1 text-faint">No generated CV HTML found. Did you run the generation yet?</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition-colors max-sm:min-h-[44px]",
              dirty
                ? "bg-brand text-brand-foreground hover:bg-brand-200"
                : "border border-border bg-surface text-muted",
            )}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : <Save className="size-4" />}
            {saved ? "Saved" : "Save"}
          </button>
          
          <button
            type="button"
            onClick={generatePdf}
            disabled={generating || !exists}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-emerald-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 max-sm:min-h-[44px]"
          >
            {generating ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
            Generate PDF
          </button>

          {pdfReady && (
            <a
              href={`/api/cv-pdf?company=${encodeURIComponent(company)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-5 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-500/15 dark:text-emerald-400 max-sm:min-h-[44px]"
            >
              <FileText className="size-4" /> View PDF
            </a>
          )}
        </div>
      </div>

      {!loaded ? (
        <div className="mt-6 text-sm text-muted">Loading…</div>
      ) : exists ? (
        <div className="mt-6 rounded-2xl border border-border bg-surface/30 p-5 shadow-sm overflow-auto">
          <div
            ref={editorRef}
            className="min-h-[60vh] max-w-none bg-white p-8 text-black shadow-sm outline-none ring-1 ring-black/5"
            contentEditable
            suppressContentEditableWarning
            onInput={() => setDirty(true)}
            dangerouslySetInnerHTML={{ __html: content }}
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          />
        </div>
      ) : null}
    </div>
  );
}
