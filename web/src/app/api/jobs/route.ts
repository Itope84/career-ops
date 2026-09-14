import { NextResponse } from "next/server";
import { listJobs } from "@/lib/core/run-registry";
import { debugEnabled } from "@/lib/career-ops";

// The durable, connection-independent source of truth for "what's running and
// what happened" — see run-registry.ts's header for why this exists. The
// client polls this (on mount, on visibilitychange, and while anything is
// running) instead of inferring completion by watching applications.md for a
// row that might match, or relying solely on an SSE stream that dies the
// moment a tab is backgrounded or closed.
export async function GET() {
  return NextResponse.json({ debugEnabled: debugEnabled(), jobs: listJobs() });
}
