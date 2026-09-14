"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CoverEnvelope, CoverStatus } from "@/lib/cover/types";

type Result = { letterMarkdown?: string; pdfPath?: string; note?: string } | null;

type CoverCtx = {
  modalOpen: boolean;
  status: CoverStatus | "idle";
  company: string;
  current: CoverEnvelope | null;
  result: Result;
  error: string;
  /** Start (or resume) a cover letter for a report number, or from a pasted JD. */
  open: (opts: { reportNum?: string; jd?: string; company?: string }) => Promise<void>;
  /** Send the user's answers for the current `collect`/`review` step. */
  submit: (answers: Record<string, string>) => Promise<void>;
  /** Hide the modal but keep the session on disk (reopen resumes it). */
  close: () => void;
  /** Reopen the persisted session's modal (no new turn). */
  reopen: () => void;
  /** Abandon the session entirely and start fresh. */
  reset: () => void;
};

const Ctx = createContext<CoverCtx | null>(null);
export function useCover(): CoverCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCover must be used within <CoverProvider>");
  return c;
}

const CONFIG_KEY = "career-ops:config";
const ACTIVE_KEY = "career-ops:cover-active";
function cliId(): string | null {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}").cliId || null;
  } catch {
    return null;
  }
}

/** Read persisted active-session info (session ID + report number). */
function readActive(): { id: string; reportNum?: string } | null {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    // Backwards compat: older sessions stored just the bare ID string.
    if (raw.startsWith("{")) return JSON.parse(raw);
    return { id: raw };
  } catch {
    return null;
  }
}
function writeActive(id: string, reportNum?: string) {
  localStorage.setItem(ACTIVE_KEY, JSON.stringify({ id, reportNum }));
}

type Snapshot = { status: CoverStatus; company?: string; current: CoverEnvelope | null; result: Result; error?: string | null };

export function CoverProvider({ children }: { children: React.ReactNode }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [status, setStatus] = useState<CoverStatus | "idle">("idle");
  const [company, setCompany] = useState("");
  const [current, setCurrent] = useState<CoverEnvelope | null>(null);
  const [result, setResult] = useState<Result>(null);
  const [error, setError] = useState("");
  const sessionId = useRef<string | null>(null);
  const activeReport = useRef<string | undefined>(undefined);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
  }, []);

  const apply = useCallback((d: Snapshot) => {
    setStatus(d.status);
    if (d.company) setCompany(d.company);
    setCurrent(d.current ?? null);
    setResult(d.result ?? null);
    setError(d.error ?? "");
  }, []);

  // Fetch the session once; keep polling while it's still thinking.
  const poll = useCallback(
    async (id: string) => {
      stopPolling();
      try {
        const r = await fetch(`/api/cover/${id}`, { cache: "no-store" });
        if (!r.ok) {
          if (r.status === 404) {
            setError("This cover-letter session expired. Start a new one.");
            setStatus("error");
            localStorage.removeItem(ACTIVE_KEY);
            activeReport.current = undefined;
          }
          return;
        }
        const d = (await r.json()) as Snapshot;
        apply(d);
        if (d.status === "thinking") pollTimer.current = setTimeout(() => void poll(id), 3000);
      } catch {
        // transient network blip — try again shortly rather than giving up.
        pollTimer.current = setTimeout(() => void poll(id), 4000);
      }
    },
    [apply, stopPolling],
  );

  const open = useCallback(
    async (opts: { reportNum?: string; jd?: string; company?: string }) => {
      // If a session is already active *for the same job* and is still in
      // progress, just reopen the modal — don't fire a brand-new API call.
      const sameJob = opts.reportNum && opts.reportNum === activeReport.current;
      const existingId = sessionId.current;
      if (sameJob && existingId && (status === "awaiting-input" || status === "review" || status === "thinking" || status === "done")) {
        setModalOpen(true);
        if (status === "thinking") void poll(existingId);
        return;
      }

      // Different job (or no active session) — clean up any stale session first.
      if (existingId && !sameJob) {
        stopPolling();
        sessionId.current = null;
        activeReport.current = undefined;
        localStorage.removeItem(ACTIVE_KEY);
      }

      const cli = cliId();
      setModalOpen(true);
      setError("");
      setResult(null);
      setCurrent(null);
      setCompany(opts.company ?? "");
      if (!cli) {
        setStatus("error");
        setError("Pick a CLI in Config first, then generate the letter.");
        return;
      }
      setStatus("thinking");
      try {
        const r = await fetch("/api/cover/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reportNum: opts.reportNum, jd: opts.jd, company: opts.company, cliId: cli }),
        });
        const d = await r.json();
        if (!r.ok || d.error) {
          setStatus("error");
          setError(d.error || "Couldn't start the cover letter.");
          return;
        }
        sessionId.current = d.id;
        activeReport.current = opts.reportNum;
        writeActive(d.id, opts.reportNum);
        void poll(d.id);
      } catch {
        setStatus("error");
        setError("Couldn't reach the server to start the cover letter.");
      }
    },
    [poll, status, stopPolling],
  );

  const submit = useCallback(
    async (answers: Record<string, string>) => {
      const id = sessionId.current;
      if (!id) return;
      setStatus("thinking");
      setError("");
      setCurrent(null);
      try {
        const r = await fetch("/api/cover/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, answers }),
        });
        const d = await r.json();
        if (!r.ok || d.error) {
          setStatus("error");
          setError(d.error || "Couldn't send your answers.");
          return;
        }
        void poll(id);
      } catch {
        setStatus("error");
        setError("Couldn't reach the server to send your answers.");
      }
    },
    [poll],
  );

  const close = useCallback(() => {
    stopPolling();
    setModalOpen(false);
  }, [stopPolling]);

  const reopen = useCallback(() => {
    setModalOpen(true);
    const id = sessionId.current;
    if (id && (status === "thinking" || status === "idle")) void poll(id);
  }, [poll, status]);

  const reset = useCallback(() => {
    stopPolling();
    sessionId.current = null;
    activeReport.current = undefined;
    localStorage.removeItem(ACTIVE_KEY);
    setModalOpen(false);
    setStatus("idle");
    setCompany("");
    setCurrent(null);
    setResult(null);
    setError("");
  }, [stopPolling]);

  // On mount: if there's a persisted active session that isn't finished, restore
  // its state silently so the button / reopen can pick it up — but do NOT
  // auto-open the modal. The user reopens via the cover-letter button.
  useEffect(() => {
    const active = readActive();
    if (!active) return;
    sessionId.current = active.id;
    activeReport.current = active.reportNum;
    (async () => {
      try {
        const r = await fetch(`/api/cover/${active.id}`, { cache: "no-store" });
        if (!r.ok) {
          localStorage.removeItem(ACTIVE_KEY);
          return;
        }
        const d = (await r.json()) as Snapshot;
        apply(d);
        // Keep polling if the AI is still thinking so state stays fresh,
        // but don't open the modal — the user will click the button.
        if (d.status === "thinking") void poll(active.id);
        else if (d.status === "done") { localStorage.removeItem(ACTIVE_KEY); activeReport.current = undefined; }
      } catch {
        /* offline — leave it for a later reopen */
      }
    })();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(
    () => ({ modalOpen, status, company, current, result, error, open, submit, close, reopen, reset }),
    [modalOpen, status, company, current, result, error, open, submit, close, reopen, reset],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
