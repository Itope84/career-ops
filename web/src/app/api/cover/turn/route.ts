import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, findReportFile } from "@/lib/career-ops";
import { createSession, readSession, spawnTurn, writeSession } from "@/lib/cover/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Start a new cover-letter conversation, or advance an existing one with the
// user's answers. Either way we spawn the agent turn in the BACKGROUND and
// return the session id immediately — the client polls GET /api/cover/[id].
export async function POST(req: Request) {
  let body: { id?: string; reportNum?: string; jd?: string; cliId?: string; company?: string; answers?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  // Continue an existing session with answers.
  if (body.id) {
    const s = readSession(body.id);
    if (!s) return Response.json({ error: "session not found (it may have expired)" }, { status: 404 });
    if (s.status === "thinking") return Response.json({ id: s.id }); // a turn is already running
    s.transcript.push({ role: "user", answers: body.answers ?? {} });
    writeSession(s);
    spawnTurn(s);
    return Response.json({ id: s.id });
  }

  // New session.
  const cliId = body.cliId;
  if (!cliId) return Response.json({ error: "Pick a CLI in Config first, then generate the letter." }, { status: 400 });

  // A grounded letter needs the CV — refuse rather than hallucinate a profile.
  if (!fs.existsSync(path.join(careerOpsRoot(), "cv.md"))) {
    return Response.json({ error: "Add your CV first so I can write in your voice — drop it on the home page." }, { status: 400 });
  }
  // The cover mode is the flow source of truth — need a complete checkout.
  if (!fs.existsSync(path.join(careerOpsRoot(), "modes", "cover.md"))) {
    return Response.json({ error: "This needs a complete career-ops checkout (modes/cover.md is missing)." }, { status: 400 });
  }

  const reportNum = body.reportNum?.trim() || null;
  const jd = body.jd?.trim() || null;
  if (!reportNum && !jd) {
    return Response.json({ error: "Provide a report to base the letter on, or paste a job description." }, { status: 400 });
  }
  if (reportNum && !findReportFile(reportNum)) {
    return Response.json({ error: `No evaluation report found for #${reportNum}.` }, { status: 404 });
  }

  const s = createSession({ reportNum, jd, company: body.company?.trim() || "", cliId });
  spawnTurn(s);
  return Response.json({ id: s.id });
}
