import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getHtmlPath(company: string) {
  if (!company) return null;
  const slug = (company.toLowerCase().match(/[a-z0-9]+/g) ?? []).join("-");
  const dir = path.join(careerOpsRoot(), "output");
  const re = new RegExp(`(^|[^a-z0-9])${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");

  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".html") && f.toLowerCase().startsWith("cv-"))
      .filter((f) => re.test(f.toLowerCase()))
      .sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
    
    if (files.length > 0) return path.join(dir, files[0]);
  } catch {}
  return null;
}

export async function GET(req: NextRequest) {
  const company = (req.nextUrl.searchParams.get("company") ?? "").trim();
  const file = getHtmlPath(company);
  if (!file) return NextResponse.json({ exists: false });

  try {
    return NextResponse.json({ content: fs.readFileSync(file, "utf8"), exists: true, path: file });
  } catch {
    return NextResponse.json({ exists: false });
  }
}

export async function POST(req: NextRequest) {
  const company = (req.nextUrl.searchParams.get("company") ?? "").trim();
  const file = getHtmlPath(company);
  if (!file) return NextResponse.json({ error: "no file found" }, { status: 404 });

  let body: { content?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "content required" }, { status: 400 });
  }

  try {
    fs.writeFileSync(file, body.content, "utf8");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "write failed" }, { status: 500 });
  }
}
