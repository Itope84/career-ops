"use client";

import { PenLine } from "lucide-react";
import { useCover } from "@/components/cover/cover-provider";
import { CostBadge } from "@/components/cost/cost-badge";

// Entry point on the report page — opens the interactive cover-letter modal for
// THIS application (slug mode: grounded in reports/{n}-…). Mirrors
// GeneratePdfButton's placement + cost affordance (generating spends tokens).
export function CoverLetterButton({ n, company }: { n: string; company: string }) {
  const { open } = useCover();
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        onClick={() => void open({ reportNum: n, company })}
        className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand max-sm:min-h-[44px]"
        title="Draft a tailored cover letter for this role"
      >
        <PenLine className="size-3.5" /> Cover letter
      </button>
      <CostBadge kind="spend" size="xs" />
    </span>
  );
}
