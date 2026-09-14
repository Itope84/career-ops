"use client";

import { useEffect, useState } from "react";
import { Loader2, Globe, Search } from "lucide-react";
import { cn } from "@/lib/cn";

type PortalItem = {
  name: string;
  url?: string;
  enabled?: boolean;
};

type PortalsData = {
  job_boards?: PortalItem[];
  search_queries?: PortalItem[];
  tracked_companies?: PortalItem[];
};

export function PortalsEditor() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PortalsData>({});

  useEffect(() => {
    fetch("/api/portals")
      .then(res => res.json())
      .then(d => setData(d))
      .finally(() => setLoading(false));
  }, []);

  async function toggle(name: string, current: boolean) {
    const next = !current;
    
    // Optimistic update
    const patchArray = (arr?: PortalItem[]) => 
      arr?.map(item => item.name === name ? { ...item, enabled: next } : item);
    
    setData(prev => ({
      ...prev,
      job_boards: patchArray(prev.job_boards),
      search_queries: patchArray(prev.search_queries),
      tracked_companies: patchArray(prev.tracked_companies),
    }));

    try {
      await fetch("/api/portals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toggle: { name, enabled: next } })
      });
    } catch (e) {
      // Rollback on error
      const rollbackArray = (arr?: PortalItem[]) => 
        arr?.map(item => item.name === name ? { ...item, enabled: current } : item);
      setData(prev => ({
        ...prev,
        job_boards: rollbackArray(prev.job_boards),
        search_queries: rollbackArray(prev.search_queries),
        tracked_companies: rollbackArray(prev.tracked_companies),
      }));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted py-8">
        <Loader2 className="size-4 animate-spin" /> Loading portals...
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {data.tracked_companies && data.tracked_companies.length > 0 && (
        <div>
          <label className="mb-3 block text-xs font-semibold uppercase tracking-[0.18em] text-muted flex items-center gap-1.5">
            <Globe className="size-4" /> Tracked Companies (Direct ATS)
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.tracked_companies.map(c => (
              <ToggleCard 
                key={c.name}
                name={c.name} 
                enabled={c.enabled !== false} 
                onToggle={() => toggle(c.name, c.enabled !== false)}
              />
            ))}
          </div>
        </div>
      )}

      {data.job_boards && data.job_boards.length > 0 && (
        <div>
          <label className="mb-3 block text-xs font-semibold uppercase tracking-[0.18em] text-muted flex items-center gap-1.5">
            <Globe className="size-4" /> Job Boards & Platforms
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.job_boards.map(b => (
              <ToggleCard 
                key={b.name}
                name={b.name} 
                enabled={b.enabled !== false} 
                onToggle={() => toggle(b.name, b.enabled !== false)}
              />
            ))}
          </div>
        </div>
      )}

      {data.search_queries && data.search_queries.length > 0 && (
        <div>
          <label className="mb-3 block text-xs font-semibold uppercase tracking-[0.18em] text-muted flex items-center gap-1.5">
            <Search className="size-4" /> Custom Search Queries
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.search_queries.map(q => (
              <ToggleCard 
                key={q.name}
                name={q.name} 
                enabled={q.enabled !== false} // default true
                onToggle={() => toggle(q.name, q.enabled !== false)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ToggleCard({ name, enabled, onToggle }: { name: string; enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "flex items-center justify-between gap-4 rounded-xl border px-4 py-3 text-left transition-colors max-sm:min-h-[44px]",
        enabled
          ? "border-brand/50 bg-brand-soft"
          : "border-border bg-surface/30 opacity-60 hover:opacity-100"
      )}
    >
      <span className={cn("text-sm font-medium", enabled ? "text-foreground" : "text-muted")}>
        {name}
      </span>
      <span
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
          enabled ? "bg-brand" : "bg-surface-hover border border-border"
        )}
      >
        <span
          className={cn(
            "absolute top-[1.5px] size-4 rounded-full bg-white shadow transition-transform",
            enabled ? "translate-x-[1.125rem]" : "translate-x-0.5"
          )}
        />
      </span>
    </button>
  );
}
