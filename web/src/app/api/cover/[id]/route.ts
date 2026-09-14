import { readSession, reapIfStale } from "@/lib/cover/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Poll target for the modal. Returns the session's current phase — the client
// keeps polling while status === "thinking". A dead "thinking" (server restart
// mid-turn) is reaped into a retryable error here so the UI never hangs.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const s = readSession(id);
  if (!s) return Response.json({ error: "not found" }, { status: 404 });
  const fresh = reapIfStale(s);
  return Response.json(
    {
      id: fresh.id,
      status: fresh.status,
      company: fresh.company,
      current: fresh.current,
      result: fresh.result,
      error: fresh.error,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
