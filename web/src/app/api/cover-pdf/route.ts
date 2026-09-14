import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serve the generated cover-letter PDF the cover flow wrote (its envelope carries
// the exact output/ path). Local-first: reads the user's own output/ dir. Guarded
// so `path` can only resolve to a .pdf INSIDE <root>/output (no traversal).
export async function GET(req: NextRequest) {
  const rel = (req.nextUrl.searchParams.get("path") ?? "").trim();
  if (!rel || !rel.toLowerCase().endsWith(".pdf")) return new Response("bad path", { status: 400 });

  const outDir = path.join(careerOpsRoot(), "output");
  const abs = path.resolve(outDir, path.basename(rel)); // basename → never escape output/
  if (path.dirname(abs) !== outDir) return new Response("bad path", { status: 400 });

  let buf: Buffer;
  try {
    buf = fs.readFileSync(abs);
  } catch {
    return new Response("not found", { status: 404 });
  }
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${path.basename(abs)}"`,
      "Cache-Control": "no-store",
    },
  });
}
