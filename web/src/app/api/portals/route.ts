import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Merge-safe writer for portals.yml's title_filter (a USER-LAYER file). Replaces
// ONLY title_filter.positive (the role keywords the free scanner matches), seeding
// from templates/portals.example.yml on first create, and PRESERVING tracked_companies
// + every other block. Atomic write, confirm-gated (setProfile/setPortals). This is
// what loads the very first home scan once the user confirms their target roles.

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export async function POST(req: Request) {
  let body: { roles?: string[]; location?: string[]; toggle?: { name: string; enabled: boolean } };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const root = careerOpsRoot();
  const file = path.join(root, "portals.yml");
  let doc: Record<string, unknown> = {};
  try {
    doc = (yaml.load(fs.readFileSync(file, "utf8")) as Record<string, unknown>) || {};
  } catch {
    try {
      doc = (yaml.load(fs.readFileSync(path.join(root, "templates", "portals.example.yml"), "utf8")) as Record<string, unknown>) || {};
    } catch {
      doc = {};
    }
  }

  if (body.roles) {
    const tf = isObj(doc.title_filter) ? { ...doc.title_filter } : {};
    tf.positive = body.roles.map((r) => String(r).trim()).filter(Boolean).slice(0, 24);
    doc.title_filter = tf;
  }
  
  if (Array.isArray(body.location) && body.location.length) {
    const lf = isObj(doc.location_filter) ? { ...doc.location_filter } : {};
    lf.allow = body.location.map((l) => String(l).trim()).filter(Boolean);
    doc.location_filter = lf;
  }

  // Handle toggling of sources
  if (body.toggle) {
    const { name, enabled } = body.toggle;
    const blocks = ["tracked_companies", "job_boards", "search_queries"];
    for (const block of blocks) {
      if (Array.isArray(doc[block])) {
        const item = doc[block].find((i: any) => i.name === name);
        if (item) {
          item.enabled = enabled;
          break;
        }
      }
    }
  }

  try {
    atomicWriteWithBackup(file, yaml.dump(doc, { lineWidth: 100, noRefs: true }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, roles: body.roles?.length ?? 0 });
}

export async function GET() {
  const root = careerOpsRoot();
  const file = path.join(root, "portals.yml");
  if (!fs.existsSync(file)) return Response.json({});
  try {
    const parsed = yaml.load(fs.readFileSync(file, "utf8"));
    return Response.json(parsed);
  } catch (e) {
    return Response.json({ error: "invalid yaml" }, { status: 500 });
  }
}
