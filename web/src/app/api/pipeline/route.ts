import * as fs from "fs";
import * as path from "path";
import { pipelineSummary } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // always read fresh local files

// Exposes the user's pipeline (inbox + tracker) to the client so the assistant
// can resolve "all the Anthropic ones" to concrete postings CLIENT-SIDE — the
// model only ever emits a company name, never URLs (no hallucination, no tokens).
export async function GET() {
  const s = pipelineSummary();
  return Response.json({
    inbox: s.inbox,
    applications: s.applications,
    root: s.root,
    rootExists: s.rootExists,
  });
}

export async function POST(req: Request) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return Response.json({ error: "Invalid URL" }, { status: 400 });
    }

    const s = pipelineSummary();
    if (!s.rootExists) {
      return Response.json({ error: "pipeline.md not found" }, { status: 500 });
    }

    let company = "?";
    let role = "?";
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 2000);
      const htmlRes = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      if (htmlRes.ok) {
        const html = await htmlRes.text();
        const match = html.match(/<title>([^<]*)<\/title>/i);
        if (match && match[1]) {
          const titleText = match[1].trim();
          // Common patterns: "Role - Company", "Role | Company", "Role at Company"
          const parts = titleText.split(/\s+[-|]\s+|\s+at\s+/i);
          if (parts.length > 1) {
            role = parts[0].trim();
            company = parts[parts.length - 1].trim();
          } else {
            role = titleText;
          }
          // Remove newlines to avoid breaking the markdown table format
          role = role.replace(/\n/g, " ");
          company = company.replace(/\n/g, " ");
        }
      }
    } catch {
      // ignore fetch errors, fall back to ? | ?
    }

    const pipelinePath = path.join(s.root, "data", "pipeline.md");
    
    // Append to pipeline.md in the exact format required by the parser:
    // - [ ] URL | Company | Role
    fs.appendFileSync(pipelinePath, `\n- [ ] ${url.trim()} | ${company} | ${role}\n`);

    return Response.json({ success: true });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

// Removes ONE pending row from pipeline.md's "## Pending" section by exact URL
// match. Deliberately does NOT touch scan-history.tsv — a single swipe-delete
// means "not this one", not "let me re-triage from scratch" (bulk /clear does
// reset scan-history; this route intentionally doesn't, so the URL stays
// deduped and won't resurface on a future scan).
export async function DELETE(req: Request) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return Response.json({ error: "Invalid URL" }, { status: 400 });
    }

    const s = pipelineSummary();
    if (!s.rootExists) {
      return Response.json({ error: "pipeline.md not found" }, { status: 500 });
    }
    const pipelinePath = path.join(s.root, "data", "pipeline.md");
    let raw: string;
    try {
      raw = fs.readFileSync(pipelinePath, "utf8");
    } catch {
      return Response.json({ error: "pipeline.md not found" }, { status: 404 });
    }

    const lines = raw.split("\n");
    const target = url.trim();
    let removed = false;
    const next = lines.filter((line) => {
      const m = line.match(/^\s*-\s*\[( |x|X)\]\s*(.+)$/);
      if (!m) return true;
      const firstField = m[2].split("|")[0].trim();
      if (firstField === target) {
        removed = true;
        return false;
      }
      return true;
    });
    if (!removed) {
      return Response.json({ error: "URL not found in pipeline.md" }, { status: 404 });
    }

    atomicWriteWithBackup(pipelinePath, next.join("\n"));
    return Response.json({ success: true });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
