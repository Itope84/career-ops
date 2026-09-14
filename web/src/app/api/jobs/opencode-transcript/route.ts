import { NextResponse } from "next/server";
import { readOpencodeTranscript } from "@/lib/core/opencode-transcript";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// On-demand only — the debug sidebar/detail page fetches this behind an
// explicit "load transcript" click, never automatically. Reading opencode's
// database (via the sqlite3 binary, one process per call) is cheap but has no
// reason to run on every job list poll.
//
// `sessionId` comes straight off the job record's `opencodeSessionId` — set
// only when the job actually ran on opencode (see run-registry.ts). There is
// no per-job lookup here on purpose: the id IS the query key, and the caller
// already has it from GET /api/jobs.
export async function GET(req: Request) {
  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId || !sessionId.trim()) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }
  const messages = readOpencodeTranscript(sessionId.trim());
  if (!messages) {
    return NextResponse.json(
      { error: "No transcript found — sqlite3 may be unavailable, or this session id no longer exists in opencode's database." },
      { status: 404 },
    );
  }
  return NextResponse.json({ messages });
}
