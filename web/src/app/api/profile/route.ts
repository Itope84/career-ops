import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { applyCompensation, type CompensationInput } from "@/lib/compensation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Merge-safe writer for config/profile.yml (a USER-LAYER file — DATA_CONTRACT:
// never clobber the user's archetypes/narrative/proof-points). On first create we
// seed from config/profile.example.yml; on an existing file we deep-merge ONLY the
// proposed keys, write atomically (temp + rename), and only ever via the confirm-
// gated setProfile action. The web orchestrates the real file — no parallel store.

type ProfilePatch = {
  name?: string;
  email?: string;
  location?: string;
  roles?: string[];
  target_range?: string;
  currency?: string;
  remote?: string;
  /** Canonical salary numbers from the UI. `cutoff` is the only one any gate
   *  reads; the range pair is display. See lib/compensation.ts. */
  cutoff?: number | null;
  range_min?: number | null;
  range_max?: number | null;
  archetypes?: any[];
  headline?: string;
  exit_story?: string;
  superpowers?: string[];
  proof_points?: any[];
};

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Deep-merge src onto dst (objects recurse; arrays/scalars replace). Non-mutating. */
function deepMerge(dst: unknown, src: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = isObj(dst) ? { ...dst } : {};
  for (const [k, v] of Object.entries(src)) {
    out[k] = isObj(v) ? deepMerge(out[k], v) : v;
  }
  return out;
}

function patchToProfile(p: ProfilePatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const candidate: Record<string, unknown> = {};
  if (p.name) candidate.full_name = p.name;
  if (p.email) candidate.email = p.email;
  if (p.location) candidate.location = p.location;
  if (Object.keys(candidate).length) out.candidate = candidate;
  if (p.roles?.length) {
    out.target_roles = { primary: p.roles };
    if (p.archetypes) (out.target_roles as any).archetypes = p.archetypes;
  } else if (p.archetypes) {
    out.target_roles = { archetypes: p.archetypes };
  }

  const narrative: Record<string, unknown> = {};
  if (p.headline) narrative.headline = p.headline;
  if (p.exit_story) narrative.exit_story = p.exit_story;
  if (p.superpowers) narrative.superpowers = p.superpowers;
  if (p.proof_points) narrative.proof_points = p.proof_points;
  if (Object.keys(narrative).length) out.narrative = narrative;

  const comp: Record<string, unknown> = {};
  // target_range is DERIVED from the range pair (see lib/compensation.ts) and
  // is only accepted raw for older clients that still post it on its own.
  if (p.target_range && p.cutoff == null && p.range_min == null) comp.target_range = p.target_range;
  if (p.currency) comp.currency = p.currency;
  if (p.remote) comp.location_flexibility = p.remote;
  if (Object.keys(comp).length) out.compensation = comp;
  // seniority intentionally not written (no canonical home in profile.yml);
  // archetypes/narrative live in modes/_profile.md — this writer never touches them.
  return out;
}

export async function POST(req: Request) {
  let patch: ProfilePatch;
  try {
    patch = (await req.json()) as ProfilePatch;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const proposed = patchToProfile(patch);
  if (Object.keys(proposed).length === 0) return Response.json({ error: "nothing to write" }, { status: 400 });

  const root = careerOpsRoot();
  const file = path.join(root, "config", "profile.yml");
  let base: Record<string, unknown> = {};
  let seeded = false;
  // DATA-LOSS GUARD (maintainer, bug-class #649/#704/#920/#958): distinguish
  // "no profile yet" (safe to seed from the example) from "profile EXISTS but is
  // malformed" (NEVER overwrite — that would silently destroy the user's data).
  if (!fs.existsSync(file)) {
    try {
      base = (yaml.load(fs.readFileSync(path.join(root, "config", "profile.example.yml"), "utf8")) as Record<string, unknown>) || {};
      seeded = Object.keys(base).length > 0;
    } catch {
      base = {};
    }
  } else {
    let parsed: unknown;
    try {
      parsed = yaml.load(fs.readFileSync(file, "utf8"));
    } catch {
      return Response.json({ error: "config/profile.yml exists but is not valid YAML — refusing to overwrite it." }, { status: 409 });
    }
    base = isObj(parsed) ? (parsed as Record<string, unknown>) : {};
  }

  const merged = deepMerge(base, proposed);

  // Compensation is applied AFTER the merge, not through it: one edit has to
  // reach `minimum`, `target_range` and every markets[] entry at once, and a
  // key-by-key deep merge cannot express "regenerate the derived strings from
  // these three numbers" (that is exactly how the UI ended up moving a label
  // while every real gate kept the old figure).
  const compTouched = patch.cutoff != null || patch.range_min != null || patch.range_max != null;
  if (compTouched) {
    merged.compensation = applyCompensation(merged.compensation as Record<string, unknown> | undefined, {
      cutoff: patch.cutoff ?? null,
      rangeMin: patch.range_min ?? null,
      rangeMax: patch.range_max ?? null,
      currency: patch.currency || ((merged.compensation as Record<string, unknown>)?.currency as string) || "EUR",
    } satisfies CompensationInput);
  }

  try {
    // Back up the prior profile before the first normalized write (yaml.dump
    // reformats — comments are not preserved; the .bak is the safety net).
    atomicWriteWithBackup(file, yaml.dump(merged, { lineWidth: 100, noRefs: true }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }

  // portals.yml is a SEPARATE file the profile editor never used to touch, and
  // its salary_filter.min is what drops postings at scan time — before they can
  // ever reach the inbox. Leaving it behind is what made a UI change look like
  // it had done nothing. Best-effort: a profile save must still succeed if
  // portals.yml is missing or hand-broken.
  let portalsUpdated = false;
  if (compTouched && patch.cutoff != null) {
    portalsUpdated = syncPortalsSalaryFloor(root, patch.cutoff, patch.currency);
  }

  return Response.json({ ok: true, seeded, portalsUpdated });
}

/**
 * Mirror the cutoff into portals.yml's `salary_filter.min`.
 *
 * NOTE `max` is intentionally untouched. In scan.mjs's `buildSalaryFilter`,
 * max is an UPPER bound — postings paying more than it are filtered out — so
 * deriving it from a target-range ceiling would quietly bin the best-paying
 * roles. It stays whatever a human set (0 = no upper limit).
 */
function syncPortalsSalaryFloor(root: string, cutoff: number, currency?: string): boolean {
  const portalsPath = path.join(root, "portals.yml");
  if (!fs.existsSync(portalsPath)) return false;
  try {
    const parsed = yaml.load(fs.readFileSync(portalsPath, "utf8"));
    if (!isObj(parsed)) return false;
    const filter: Record<string, unknown> = isObj(parsed.salary_filter) ? { ...parsed.salary_filter } : { max: 0 };
    filter.min = Math.round(cutoff);
    if (currency) filter.currency = currency.trim().toUpperCase();
    atomicWriteWithBackup(portalsPath, yaml.dump({ ...parsed, salary_filter: filter }, { lineWidth: 100, noRefs: true }));
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const root = careerOpsRoot();
  const file = path.join(root, "config", "profile.yml");
  if (!fs.existsSync(file)) return Response.json({});
  try {
    const parsed = yaml.load(fs.readFileSync(file, "utf8"));
    return Response.json(parsed);
  } catch (e) {
    return Response.json({ error: "invalid yaml" }, { status: 500 });
  }
}
