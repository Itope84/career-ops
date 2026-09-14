"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, User, MapPin, PoundSterling, Briefcase, FileText, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/cn";

type ProfileData = {
  candidate?: { full_name?: string; email?: string; location?: string };
  target_roles?: { primary?: string[]; archetypes?: any[] };
  narrative?: { headline?: string; exit_story?: string; superpowers?: string[]; proof_points?: any[] };
  compensation?: {
    target_range?: string; currency?: string; location_flexibility?: string;
    cutoff?: number; range_min?: number; range_max?: number; minimum?: string;
  };
};

/** Mirrors lib/compensation.ts's parseMoney, for pre-filling from a profile
 *  that still only has the legacy display strings ("€35,000", "€35k+"). */
function parseLegacyMoney(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw > 0 ? raw : null;
  if (typeof raw !== "string") return null;
  const m = raw.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([kK])?/);
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (m[2]) n *= 1000;
  if (n < 1000) n *= 1000;
  return n;
}

const num = (v: string): number | null => {
  const n = Number(v.trim());
  return v.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
};

export function ProfileEditor() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [location, setLocation] = useState("");
  const [roles, setRoles] = useState("");
  // Canonical salary numbers. Strings in state (an empty input must stay empty,
  // not become 0 and silently write a zero floor); coerced on save.
  const [cutoff, setCutoff] = useState("");
  const [rangeMin, setRangeMin] = useState("");
  const [rangeMax, setRangeMax] = useState("");
  const [currency, setCurrency] = useState("GBP");
  const [remote, setRemote] = useState("");

  const [headline, setHeadline] = useState("");
  const [exitStory, setExitStory] = useState("");
  const [superpowers, setSuperpowers] = useState("");
  
  type Archetype = { name: string; level: string; fit: string; note: string };
  type ProofPoint = { name: string; hero_metric: string };

  const [archetypes, setArchetypes] = useState<Archetype[]>([]);
  const [proofPoints, setProofPoints] = useState<ProofPoint[]>([]);

  useEffect(() => {
    fetch("/api/profile")
      .then(res => res.json())
      .then((data: ProfileData) => {
        if (data.candidate) {
          setName(data.candidate.full_name || "");
          setEmail(data.candidate.email || "");
          setLocation(data.candidate.location || "");
        }
        if (data.target_roles) {
          setRoles(data.target_roles.primary?.join(", ") || "");
          setArchetypes(data.target_roles.archetypes || []);
        }
        if (data.narrative) {
          setHeadline(data.narrative.headline || "");
          setExitStory(data.narrative.exit_story || "");
          setSuperpowers(data.narrative.superpowers?.join("\n") || "");
          setProofPoints(data.narrative.proof_points || []);
        }
        if (data.compensation) {
          setCurrency(data.compensation.currency || "GBP");
          setRemote(data.compensation.location_flexibility || "");
          // Prefer the canonical numbers; fall back to parsing the legacy
          // display strings so an un-migrated profile still populates.
          const c = data.compensation;
          setCutoff(String(c.cutoff ?? parseLegacyMoney(c.minimum) ?? ""));
          setRangeMin(String(c.range_min ?? parseLegacyMoney(c.target_range) ?? ""));
          setRangeMax(String(c.range_max ?? ""));
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // What the save will actually generate, shown before it happens. Mirrors
  // lib/compensation.ts's formatting — this is a preview, the server derives
  // the real values.
  const sym = currency === "GBP" ? "£" : currency === "USD" ? "$" : "€";
  const short = (n: number) => {
    const k = n / 1000;
    return `${sym}${Number.isInteger(k) ? k : k.toFixed(1).replace(/\.0$/, "")}k`;
  };
  const cutN = num(cutoff), minN = num(rangeMin), maxN = num(rangeMax);
  const compPreview = cutN
    ? `cut-off ${sym}${cutN.toLocaleString("en-US")}${
        minN || maxN ? ` · range ${minN && maxN && maxN > minN ? `${short(minN)}–${short(maxN)}` : `${short((minN ?? maxN)!)}+`}` : ""
      }`
    : null;
  const cutoffWarning =
    minN && cutN && minN < cutN
      ? "Range min is below the cut-off — postings inside the bottom of your range would be filtered out before you see them."
      : maxN && minN && maxN < minN
        ? "Range max is below range min."
        : null;

  async function save() {
    setSaving(true);
    const rolesArray = roles.split(",").map(r => r.trim()).filter(Boolean);
    const powersArray = superpowers.split("\n").map(r => r.trim()).filter(Boolean);
    


    const patch = {
      name, email, location,
      roles: rolesArray,
      cutoff: num(cutoff),
      range_min: num(rangeMin),
      range_max: num(rangeMax),
      currency, remote,
      headline,
      exit_story: exitStory,
      superpowers: powersArray,
      archetypes,
      proof_points: proofPoints
    };

    try {
      await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted py-8">
        <Loader2 className="size-4 animate-spin" /> Loading profile...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5"><User className="size-3" /> Full Name</label>
          <input value={name} onChange={e => setName(e.target.value)} className="w-full rounded-xl border border-border bg-surface/60 px-4 py-2.5 text-sm outline-none transition-colors focus:border-brand/50" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5"><User className="size-3" /> Email</label>
          <input value={email} onChange={e => setEmail(e.target.value)} className="w-full rounded-xl border border-border bg-surface/60 px-4 py-2.5 text-sm outline-none transition-colors focus:border-brand/50" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5"><MapPin className="size-3" /> Base Location</label>
          <input value={location} onChange={e => setLocation(e.target.value)} className="w-full rounded-xl border border-border bg-surface/60 px-4 py-2.5 text-sm outline-none transition-colors focus:border-brand/50" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5"><MapPin className="size-3" /> Location Flexibility</label>
          <input value={remote} onChange={e => setRemote(e.target.value)} className="w-full rounded-xl border border-border bg-surface/60 px-4 py-2.5 text-sm outline-none transition-colors focus:border-brand/50" />
        </div>
      </div>

      <div className="space-y-3">
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr_110px]">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5"><PoundSterling className="size-3" /> Cut-off</label>
            <input
              type="number" inputMode="numeric" min={0} step={1000}
              value={cutoff} onChange={e => setCutoff(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface/60 px-4 py-2.5 text-sm tabular-nums outline-none transition-colors focus:border-brand/50"
              placeholder="35000"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted">Range min</label>
            <input
              type="number" inputMode="numeric" min={0} step={1000}
              value={rangeMin} onChange={e => setRangeMin(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface/60 px-4 py-2.5 text-sm tabular-nums outline-none transition-colors focus:border-brand/50"
              placeholder="35000"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted">Range max</label>
            <input
              type="number" inputMode="numeric" min={0} step={1000}
              value={rangeMax} onChange={e => setRangeMax(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface/60 px-4 py-2.5 text-sm tabular-nums outline-none transition-colors focus:border-brand/50"
              placeholder="optional"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted">Currency</label>
            <select value={currency} onChange={e => setCurrency(e.target.value)} className="w-full rounded-xl border border-border bg-surface/60 px-4 py-2.5 text-sm outline-none transition-colors focus:border-brand/50 appearance-none">
              <option value="GBP">GBP (£)</option><option value="USD">USD ($)</option><option value="EUR">EUR (€)</option>
            </select>
          </div>
        </div>
        {/* The whole point of the rewrite: say out loud which number actually
            gates anything, and show the label that will be generated, so a save
            can't silently move a display string and leave the gates behind. */}
        <p className="text-xs leading-relaxed text-muted">
          <span className="font-medium text-foreground">Cut-off</span> is the only figure that filters anything — it sets the
          scanner&apos;s salary floor and the hard reject in triage and scoring. The range is for your CV and reports.
          {compPreview && <> Saves as <span className="font-medium text-foreground tabular-nums">{compPreview}</span>.</>}
          {cutoffWarning && <span className="mt-1 block text-amber-600 dark:text-amber-500">{cutoffWarning}</span>}
        </p>
      </div>

      <button onClick={() => setAdvanced(!advanced)} className="flex items-center gap-2 text-sm font-medium text-muted hover:text-foreground transition-colors py-2">
        <ChevronDown className={cn("size-4 transition-transform", advanced && "rotate-180")} />
        Advanced (Scoring & Narrative)
      </button>

      {advanced && (
        <div className="space-y-6 rounded-2xl border border-border bg-surface/30 p-5">
          <p className="text-xs text-muted mb-4 -mt-2">This data powers the career-ops evaluation scoring and CV generation.</p>
          
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5"><Briefcase className="size-3" /> Target Roles (Comma separated)</label>
            <textarea value={roles} onChange={e => setRoles(e.target.value)} rows={2} className="w-full rounded-xl border border-border bg-surface/60 px-4 py-2.5 text-sm outline-none transition-colors focus:border-brand/50" />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5"><FileText className="size-3" /> Headline</label>
            <input value={headline} onChange={e => setHeadline(e.target.value)} className="w-full rounded-xl border border-border bg-surface/60 px-4 py-2.5 text-sm outline-none transition-colors focus:border-brand/50" />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5"><FileText className="size-3" /> Exit Story</label>
            <textarea value={exitStory} onChange={e => setExitStory(e.target.value)} rows={3} className="w-full rounded-xl border border-border bg-surface/60 px-4 py-2.5 text-sm outline-none transition-colors focus:border-brand/50" />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5"><FileText className="size-3" /> Superpowers (One per line)</label>
            <textarea value={superpowers} onChange={e => setSuperpowers(e.target.value)} rows={4} className="w-full rounded-xl border border-border bg-surface/60 px-4 py-2.5 text-sm outline-none transition-colors focus:border-brand/50" />
          </div>

          <div className="space-y-3">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5"><FileText className="size-3" /> Archetypes</label>
            <p className="text-[11px] text-faint mb-2 -mt-2">Archetypes map your experience to specific role shapes to calculate your Fit Score.</p>
            {archetypes.map((arch, i) => (
              <div key={i} className="relative rounded-xl border border-border bg-surface/40 p-4 space-y-3">
                <button onClick={() => setArchetypes(a => a.filter((_, idx) => idx !== i))} className="absolute top-3 right-3 text-muted hover:text-red-400 transition-colors"><X className="size-4" /></button>
                <div className="grid grid-cols-2 gap-3 pr-6">
                  <input value={arch.name} onChange={e => setArchetypes(a => { const next = [...a]; next[i].name = e.target.value; return next; })} placeholder="Archetype Name" className="w-full rounded-lg border border-border bg-surface/60 px-3 py-2 text-sm outline-none focus:border-brand/50 transition-colors" />
                  <select value={arch.fit} onChange={e => setArchetypes(a => { const next = [...a]; next[i].fit = e.target.value; return next; })} className="w-full rounded-lg border border-border bg-surface/60 px-3 py-2 text-sm outline-none focus:border-brand/50 transition-colors appearance-none">
                    <option value="primary">Primary Fit</option>
                    <option value="secondary">Secondary Fit</option>
                    <option value="adjacent">Adjacent Fit</option>
                  </select>
                </div>
                <input value={arch.level} onChange={e => setArchetypes(a => { const next = [...a]; next[i].level = e.target.value; return next; })} placeholder="Level (e.g. Manager / Coordinator)" className="w-full rounded-lg border border-border bg-surface/60 px-3 py-2 text-sm outline-none focus:border-brand/50 transition-colors" />
                <textarea value={arch.note} onChange={e => setArchetypes(a => { const next = [...a]; next[i].note = e.target.value; return next; })} rows={2} placeholder="Note on why this fits" className="w-full rounded-lg border border-border bg-surface/60 px-3 py-2 text-sm outline-none focus:border-brand/50 transition-colors" />
              </div>
            ))}
            <button onClick={() => setArchetypes(a => [...a, { name: "", level: "", fit: "primary", note: "" }])} className="text-sm text-brand hover:text-brand-200 transition-colors font-medium">+ Add Archetype</button>
          </div>

          <div className="space-y-3 pt-4 border-t border-border/50">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5"><FileText className="size-3" /> Proof Points</label>
            <p className="text-[11px] text-faint mb-2 -mt-2">Hard metrics and achievements injected into your CV and Cover Letters.</p>
            {proofPoints.map((pp, i) => (
              <div key={i} className="relative rounded-xl border border-border bg-surface/40 p-4 space-y-3">
                <button onClick={() => setProofPoints(p => p.filter((_, idx) => idx !== i))} className="absolute top-3 right-3 text-muted hover:text-red-400 transition-colors"><X className="size-4" /></button>
                <div className="pr-6">
                  <input value={pp.name} onChange={e => setProofPoints(p => { const next = [...p]; next[i].name = e.target.value; return next; })} placeholder="Project or Achievement Name" className="w-full rounded-lg border border-border bg-surface/60 px-3 py-2 text-sm outline-none focus:border-brand/50 transition-colors" />
                </div>
                <textarea value={pp.hero_metric} onChange={e => setProofPoints(p => { const next = [...p]; next[i].hero_metric = e.target.value; return next; })} rows={2} placeholder="Hero Metric (e.g. $250K grant won)" className="w-full rounded-lg border border-border bg-surface/60 px-3 py-2 text-sm outline-none focus:border-brand/50 transition-colors" />
              </div>
            ))}
            <button onClick={() => setProofPoints(p => [...p, { name: "", hero_metric: "" }])} className="text-sm text-brand hover:text-brand-200 transition-colors font-medium">+ Add Proof Point</button>
          </div>
        </div>
      )}

      <div className="pt-2">
        <button onClick={save} disabled={saving} className="inline-flex min-w-[120px] items-center justify-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-70 max-sm:min-h-[44px]">
          {saving ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
          {saved ? "Saved" : saving ? "Saving..." : "Save Profile"}
        </button>
      </div>
    </div>
  );
}
