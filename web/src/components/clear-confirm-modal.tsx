"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

// Type-to-confirm gate for an irreversible bulk delete. `what` is both the
// display word and the exact phrase ("clear {what}") the user must type —
// keeps the button and the required text impossible to drift apart.
export function ClearConfirmModal({
  what,
  description,
  onConfirm,
  onClose,
}: {
  what: string;
  description: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const required = `clear ${what}`;
  const match = text.trim().toLowerCase() === required;

  const confirm = async () => {
    if (!match || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to clear");
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-6 sm:items-center sm:pb-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-red-500/10 text-red-600 dark:text-red-400">
            <AlertTriangle className="size-4" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-lg text-foreground">Clear {what}?</h2>
            <p className="mt-1 text-sm text-muted">{description}</p>
          </div>
        </div>

        <p className="mt-4 text-xs text-muted">
          Type <span className="font-mono font-semibold text-foreground">{required}</span> to confirm.
        </p>
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={required}
          onKeyDown={(e) => e.key === "Enter" && confirm()}
          className="mt-2 w-full rounded-lg border border-border bg-surface/60 px-3 py-2 text-sm outline-none transition-colors focus:border-red-500/50"
        />
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-3 py-2 text-sm text-muted transition-colors hover:text-foreground min-h-[44px]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!match || busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40 min-h-[44px]"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Clear {what}
          </button>
        </div>
      </div>
    </div>
  );
}
