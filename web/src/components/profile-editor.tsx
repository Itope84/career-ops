"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, User, MapPin, PoundSterling, Briefcase, FileText, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/cn";

type ProfileData = {
  candidate?: { full_name?: string; email?: string; location?: string };
  target_roles?: { primary?: string[]; archetypes?: any[] };
  narrative?: { headline?: string; exit_story?: string; superpowers?: string[]; proof_points?: any[] };
  compensation?: { target_range?: string; currency?: string; location_flexibility?: string };
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
  const [targetRange, setTargetRange] = useState("");
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
          setTargetRange(data.compensation.target_range || "");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    const rolesArray = roles.split(",").map(r => r.trim()).filter(Boolean);
    const powersArray = superpowers.split("\n").map(r => r.trim()).filter(Boolean);
    


    const patch = {
      name, email, location,
      roles: rolesArray,
      target_range: targetRange,
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

      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5"><PoundSterling className="size-3" /> Salary Target Range</label>
          <input value={targetRange} onChange={e => setTargetRange(e.target.value)} className="w-full rounded-xl border border-border bg-surface/60 px-4 py-2.5 text-sm outline-none transition-colors focus:border-brand/50" placeholder="£40K-80K" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted">Currency</label>
          <select value={currency} onChange={e => setCurrency(e.target.value)} className="w-full rounded-xl border border-border bg-surface/60 px-4 py-2.5 text-sm outline-none transition-colors focus:border-brand/50 appearance-none">
            <option value="GBP">GBP (£)</option><option value="USD">USD ($)</option><option value="EUR">EUR (€)</option>
          </select>
        </div>
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
