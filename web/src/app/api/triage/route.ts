import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";
import { exec } from "child_process";
import { promisify } from "util";
import { careerOpsRoot } from "@/lib/career-ops";

const execAsync = promisify(exec);

// Uses Cloudflare Workers AI with Qwen 1.5 14B Chat (a solid OSS chat model)
// to perform a fast, zero-token-cost triage of a job description.
async function runCloudflareTriage(text: string, accountId: string, apiKey: string, rootDir: string) {
  const model = "@cf/zai-org/glm-4.7-flash";

  const { stdout } = await execAsync("node generate-triage-prompt.mjs", { cwd: rootDir });
  const promptTemplate = stdout.split("=== GENERATED TRIAGE PROMPT ===\n")[1];

  if (!promptTemplate) {
    throw new Error("Could not parse prompt from generate-triage-prompt.mjs");
  }

  const prompt = `${promptTemplate.trim()}

Job Description:
${text.slice(0, 4000)}`;

  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!res.ok) {
    throw new Error(`Cloudflare API error: ${await res.text()}`);
  }

  const data = await res.json();
  const responseText = (data.result?.response || "").trim().toUpperCase();
  return responseText.startsWith("NO") ? "DISCARD" : "KEEP";
}

// Basic text extractor
async function fetchJobText(url: string) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const html = await res.text();
    const $ = cheerio.load(html);
    $("script, style, nav, footer, header").remove();
    return $("body").text().replace(/\s+/g, " ").trim();
  } catch (e) {
    console.error("Error fetching URL", e);
    return "";
  }
}

export async function POST(req: Request) {
  try {
    const { url, company, role } = await req.json();
    if (!url) return NextResponse.json({ error: "No URL provided" }, { status: 400 });

    const root = careerOpsRoot();
    const envPath = path.join(root, ".env");
    let accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    let apiKey = process.env.CLOUDFLARE_API_KEY;

    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
          if (match[1] === "CLOUDFLARE_ACCOUNT_ID" && !accountId) accountId = match[2].trim();
          if (match[1] === "CLOUDFLARE_API_KEY" && !apiKey) apiKey = match[2].trim();
        }
      }
    }

    if (!accountId || !apiKey) {
      return NextResponse.json({ error: "Cloudflare credentials missing in .env" }, { status: 500 });
    }

    const text = await fetchJobText(url);
    if (!text || text.length < 50) {
      return NextResponse.json({ error: "Failed to extract job description text" }, { status: 400 });
    }

    const decision = await runCloudflareTriage(text, accountId, apiKey, root);

    if (decision === "DISCARD") {
      // Move to tracker as Discarded
      const trackerPath = path.join(process.cwd(), "..", "data", "applications.md");
      const date = new Date().toISOString().split("T")[0];
      const newRow = `| - | ${date} | ${company || "Unknown"} | ${role || "Unknown"} | 0 | Discarded | - | - | Triaged out by AI |`;
      if (fs.existsSync(trackerPath)) {
        fs.appendFileSync(trackerPath, `\n${newRow}\n`);
      }
    }

    return NextResponse.json({ decision });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
