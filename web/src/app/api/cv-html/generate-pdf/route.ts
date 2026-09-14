import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import util from "node:util";
import { careerOpsRoot } from "@/lib/career-ops";

const execFileAsync = util.promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const company = (req.nextUrl.searchParams.get("company") ?? "").trim();
  if (!company) return NextResponse.json({ error: "company required" }, { status: 400 });

  const slug = (company.toLowerCase().match(/[a-z0-9]+/g) ?? []).join("-");
  const dir = path.join(careerOpsRoot(), "output");
  const re = new RegExp(`(^|[^a-z0-9])${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");

  let htmlFile: string | null = null;
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".html") && f.toLowerCase().startsWith("cv-"))
      .filter((f) => re.test(f.toLowerCase()))
      .sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
    
    if (files.length > 0) htmlFile = files[0];
  } catch {}

  if (!htmlFile) {
    return NextResponse.json({ error: "no HTML file found" }, { status: 404 });
  }

  const inputPath = path.join(dir, htmlFile);
  const today = new Date().toISOString().slice(0, 10);
  const outputPath = path.join(dir, htmlFile.replace(/\.html$/i, `-${today}.pdf`));

  try {
    await execFileAsync("node", ["generate-pdf.mjs", inputPath, outputPath], {
      cwd: careerOpsRoot(),
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
