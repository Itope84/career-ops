import { NextResponse } from "next/server";
import { execFileSync } from "node:child_process";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";

// Persists the Shortlist tab's contents in data/pipeline.md's `## Shortlisted`
// section via shortlist-entries.mjs — replacing what used to be the
// `career-ops:shortlist` localStorage key (one browser, gone on a cleared
// cache or a different device). GET the current list from /api/pipeline
// (its `shortlist` field) — this route only mutates.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

function run(op: "add" | "remove", body: Record<string, unknown>) {
  return execFileSync(process.execPath, [rootScript("shortlist-entries")], {
    cwd: careerOpsRoot(),
    input: JSON.stringify({ op, ...body }),
    maxBuffer: 1024 * 1024,
    encoding: "utf8",
  });
}

function errorMessage(err: unknown): string {
  const stderr = (err as { stderr?: string })?.stderr?.trim();
  if (stderr) {
    try {
      return JSON.parse(stderr).error ?? stderr;
    } catch {
      return stderr;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

type AddItem = { url: string; company: string; role: string };

export async function POST(req: Request) {
  let body: { url?: string; company?: string; role?: string; items?: Array<Partial<AddItem>> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  // Batch form (`items`) is what triage uses to move a whole keep-set in one
  // lock/write; the single-item form is the manual "Save to shortlist" button.
  const raw = Array.isArray(body.items) ? body.items : [body];
  const items = raw.filter(
    (it): it is AddItem =>
      !!it && typeof it.url === "string" && !!it.url.trim() && typeof it.company === "string" && typeof it.role === "string",
  );
  if (items.length === 0) {
    return NextResponse.json({ error: "url, company, and role are required" }, { status: 400 });
  }
  try {
    const stdout = run("add", { items });
    return NextResponse.json(JSON.parse(stdout));
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// Two different user intentions share this verb, and `restore` is what tells
// them apart: un-bookmarking a role (`restore: true`) puts it BACK in the
// inbox, while ✗ deletes it outright. Both leave `## Shortlisted`; only one
// of them is meant to be seen again.
export async function DELETE(req: Request) {
  let body: { url?: string; restore?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (typeof body.url !== "string" || !body.url.trim()) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }
  try {
    const stdout = run("remove", { url: body.url, ...(body.restore === true ? { restore: true } : {}) });
    return NextResponse.json(JSON.parse(stdout));
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
