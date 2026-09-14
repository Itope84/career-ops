"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Radar, Loader2, Check, AlertTriangle } from "lucide-react";
import { CostBadge } from "@/components/cost/cost-badge";
import { cn } from "@/lib/cn";

// One-tap portal scan from the pipeline header. Runs the real zero-token
// scan.mjs via /api/scan (portals.yml + profile filters → new inbox rows) and
// streams its progress into a single status line. On success the router
// refreshes so the inbox tab shows the new rows immediately.

type Phase = "idle" | "running" | "done" | "error";

export function ScanButton() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [label, setLabel] = useState("");
  const [added, setAdded] = useState<number | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function run() {
    if (phase === "running") return;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setPhase("running");
    setAdded(null);
    setLabel("Starting scan…");
    try {
      const res = await fetch("/api/scan", { method: "POST" });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `scan failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let finished = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.type === "line" && typeof ev.text === "string") {
              setLabel(ev.text.replace(/[━─]{3,}/g, "").trim() || "Scanning…");
            } else if (ev.type === "done") {
              finished = true;
              setAdded(typeof ev.added === "number" ? ev.added : 0);
              setPhase("done");
              router.refresh();
            } else if (ev.type === "error") {
              throw new Error(ev.msg || "scan failed");
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue; // partial line
            throw e;
          }
        }
      }
      if (!finished) throw new Error("scan ended without a summary");
      resetTimer.current = setTimeout(() => setPhase("idle"), 6000);
    } catch (e) {
      setLabel(e instanceof Error ? e.message : "scan failed");
      setPhase("error");
      resetTimer.current = setTimeout(() => setPhase("idle"), 8000);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={run}
          disabled={phase === "running"}
          title="Scan your tracked portals for new roles — free, no tokens spent"
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors max-sm:min-h-[44px]",
            phase === "running"
              ? "cursor-wait border-brand/40 bg-brand-soft text-brand"
              : "border-border text-muted hover:border-brand/40 hover:text-brand",
          )}
        >
          {phase === "running" ? <Loader2 className="size-3.5 animate-spin" /> : <Radar className="size-3.5" />}
          {phase === "running" ? "Scanning portals…" : "Scan portals"}
        </button>
        {phase === "idle" && <CostBadge kind="free" size="xs" />}
      </span>
      {phase === "running" && label && (
        <span className="max-w-[16rem] truncate font-mono text-[11px] text-faint sm:max-w-xs" title={label}>
          {label}
        </span>
      )}
      {phase === "done" && (
        <span className="animate-terminal-popup inline-flex items-center gap-1 text-xs font-medium text-brand">
          <Check className="size-3" /> {added === 0 ? "No new roles this time" : `${added} new in inbox`}
        </span>
      )}
      {phase === "error" && (
        <span className="inline-flex max-w-[18rem] items-center gap-1 text-xs text-red-500 sm:max-w-xs" title={label}>
          <AlertTriangle className="size-3 shrink-0" /> <span className="truncate">{label}</span>
        </span>
      )}
    </div>
  );
}
