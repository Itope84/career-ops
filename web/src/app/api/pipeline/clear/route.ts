import * as fs from "fs";
import * as path from "path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Wipes the "## Pending" section of pipeline.md entirely (the "## Processed"
// history section is left untouched — that's a log of already-evaluated work,
// not clutter). Also removes those same URLs from scan-history.tsv so they can
// resurface on a future scan — this is a deliberate "fresh start" action, unlike
// the single-row DELETE on /api/pipeline which leaves scan-history alone.
export async function POST() {
  const root = careerOpsRoot();
  const pipelinePath = path.join(root, "data", "pipeline.md");
  const scanHistoryPath = path.join(root, "data", "scan-history.tsv");

  let raw: string;
  try {
    raw = fs.readFileSync(pipelinePath, "utf8");
  } catch {
    return Response.json({ error: "pipeline.md not found" }, { status: 404 });
  }

  const lines = raw.split("\n");
  const pendingIdx = lines.findIndex((l) => /^##\s*Pending\s*$/i.test(l.trim()));
  const processedIdx = lines.findIndex((l, i) => i > pendingIdx && /^##\s/.test(l));
  if (pendingIdx === -1) {
    return Response.json({ error: 'No "## Pending" section found in pipeline.md' }, { status: 400 });
  }
  const pendingBlock = lines.slice(pendingIdx + 1, processedIdx === -1 ? lines.length : processedIdx);

  const clearedUrls = new Set<string>();
  for (const line of pendingBlock) {
    const m = line.match(/^\s*-\s*\[( |x|X)\]\s*(.+)$/);
    if (!m) continue;
    const url = m[2].split("|")[0].trim();
    if (url) clearedUrls.add(url);
  }

  if (clearedUrls.size === 0) {
    return Response.json({ cleared: 0 });
  }

  // Rebuild: keep everything up to and including "## Pending", drop its rows,
  // then re-attach "## Processed" (+ everything after) unchanged.
  const head = lines.slice(0, pendingIdx + 1);
  const tail = processedIdx === -1 ? [] : lines.slice(processedIdx);
  const nextPipeline = [...head, "", ...tail].join("\n");
  atomicWriteWithBackup(pipelinePath, nextPipeline);

  // Reset scan-history so the cleared URLs are eligible to resurface.
  try {
    const tsv = fs.readFileSync(scanHistoryPath, "utf8");
    const tsvLines = tsv.split("\n");
    const header = tsvLines[0];
    const rest = tsvLines.slice(1).filter((line) => {
      if (!line.trim()) return true;
      const url = line.split("\t")[0];
      return !clearedUrls.has(url);
    });
    atomicWriteWithBackup(scanHistoryPath, [header, ...rest].join("\n"));
  } catch {
    // no scan-history.tsv yet — nothing to reset, not an error
  }

  return Response.json({ cleared: clearedUrls.size });
}
