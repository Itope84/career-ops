import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, readApplications, findReportFile, trackerCanDelete } from "@/lib/career-ops";
import { canonStatus } from "@/lib/format";
import { acquireTrackerWrite, releaseTrackerWrite, isTrackerWriting } from "@/lib/core/run-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bulk-deletes every tracker row with status exactly "Evaluated" — scored but
// never acted on. Deliberately status-scoped, NOT tab-scoped: this route is
// wired to both the ALL and EVALUATED tabs' Clear button, but always means the
// same thing either way, so Applied/Interview/Offer/Rejected/etc rows are never
// touched no matter which of those two tabs you clicked it from.
//
// Reuses `tracker.mjs delete --num N` per row (the same write-gated, reindexing,
// atomic path /api/tracker/delete already uses) rather than hand-editing
// applications.md, then also removes the row's report file + any tailored
// PDFs — a real full reset, not just hiding rows.

let clearing = false;

function deleteOne(num: string): Promise<{ ok: boolean; err: string }> {
  return new Promise((resolve) => {
    let err = "";
    let child;
    try {
      child = spawn(process.execPath, [path.join(careerOpsRoot(), "tracker.mjs"), "delete", "--num", num], {
        cwd: careerOpsRoot(),
        env: process.env,
      });
    } catch (e) {
      resolve({ ok: false, err: e instanceof Error ? e.message : "failed to start tracker.mjs" });
      return;
    }
    child.stderr.on("data", (d: Buffer) => { err += d.toString(); });
    child.stdout.on("data", () => {});
    const killer = setTimeout(() => { try { child.kill("SIGTERM"); } catch {} }, 30_000);
    child.on("error", (e) => { clearTimeout(killer); resolve({ ok: false, err: e.message }); });
    child.on("close", (code) => { clearTimeout(killer); resolve({ ok: code === 0, err }); });
  });
}

// Delete every PDF (tailored CV + cover letter) whose filename contains this
// company as a token — same slug/boundary match /api/cv-pdf uses to SERVE them.
function deletePdfsForCompany(company: string): number {
  const slug = (company.toLowerCase().match(/[a-z0-9]+/g) ?? []).join("-");
  if (!slug) return 0;
  const dir = path.join(careerOpsRoot(), "output");
  const re = new RegExp(`(^|[^a-z0-9])${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf") && re.test(f.toLowerCase()));
  } catch {
    return 0;
  }
  for (const f of files) {
    try { fs.unlinkSync(path.join(dir, f)); } catch {}
  }
  return files.length;
}

export async function POST() {
  if (!trackerCanDelete()) {
    return Response.json(
      { error: "Removing tracker rows needs a newer career-ops — update to clear from here." },
      { status: 400 },
    );
  }
  if (isTrackerWriting()) {
    return Response.json({ error: "An evaluation is updating your tracker right now — try again in a moment." }, { status: 409 });
  }
  if (clearing) {
    return Response.json({ error: "A clear is already in progress — try again in a moment." }, { status: 409 });
  }

  const rows = readApplications().filter((r) => canonStatus(r.status) === "EVALUATED");
  if (rows.length === 0) {
    return Response.json({ cleared: 0, reportsDeleted: 0, pdfsDeleted: 0 });
  }

  clearing = true;
  const token = acquireTrackerWrite();
  let cleared = 0;
  let reportsDeleted = 0;
  let pdfsDeleted = 0;
  const errors: string[] = [];

  try {
    // Sequential — tracker.mjs delete rewrites + reindexes the whole file per
    // call, so concurrent calls would race each other on the same file.
    for (const row of rows) {
      const result = await deleteOne(row.n);
      if (!result.ok) {
        errors.push(`#${row.n} (${row.company}): ${result.err.trim().split("\n")[0] || "delete failed"}`);
        continue;
      }
      cleared++;

      const m = row.report?.match(/\[(\d+)\]/);
      const reportNum = m ? m[1] : row.n;
      const reportFile = findReportFile(reportNum);
      if (reportFile) {
        try {
          fs.unlinkSync(reportFile);
          reportsDeleted++;
        } catch {}
      }
      pdfsDeleted += deletePdfsForCompany(row.company);
    }
  } finally {
    releaseTrackerWrite(token);
    clearing = false;
  }

  return Response.json({ cleared, reportsDeleted, pdfsDeleted, errors: errors.length ? errors : undefined });
}
