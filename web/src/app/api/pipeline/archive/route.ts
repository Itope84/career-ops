import { NextResponse } from "next/server";
import { execFileSync } from "node:child_process";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";

// Commits a Quick Triage discard for real: moves each entry out of
// data/pipeline.md's Pending section (and logs it to data/discard.log) via
// archive-pipeline-entries.mjs — the SAME move modes/pipeline.md's own
// pre-screen gate already specifies, running under the shared file lock that
// script uses. This is the one thing the old triage route never actually did
// (it only hid rows client-side in localStorage) — a discard here is
// permanent and visible from any device, not a per-browser illusion.
//
// POST body: { items: [{ url, reason }] }
// Response:  { archived: string[], notFound: string[] }
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  let body: { items?: Array<{ url?: string; reason?: string }> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const items = Array.isArray(body.items)
    ? body.items.filter((it): it is { url: string; reason?: string } => !!it && typeof it.url === "string" && it.url.trim().length > 0)
    : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "items required" }, { status: 400 });
  }

  try {
    // Fast, bounded, local (a lock acquisition + a markdown edit) — fine to
    // run synchronously; this never approaches the request timeout.
    const stdout = execFileSync(process.execPath, [rootScript("archive-pipeline-entries")], {
      cwd: careerOpsRoot(),
      input: JSON.stringify(items),
      maxBuffer: 2 * 1024 * 1024,
      encoding: "utf8",
    });
    const result = JSON.parse(stdout);
    return NextResponse.json(result);
  } catch (err) {
    // execFileSync throws with stderr attached when the child writes to it —
    // archive-pipeline-entries.mjs always writes a JSON error there.
    const stderr = (err as { stderr?: string })?.stderr?.trim();
    let msg = err instanceof Error ? err.message : String(err);
    if (stderr) {
      try {
        msg = JSON.parse(stderr).error ?? stderr;
      } catch {
        msg = stderr;
      }
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
