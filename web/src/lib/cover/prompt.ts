import path from "node:path";
import { careerOpsRoot, findReportFile, readMemory } from "@/lib/career-ops";
import type { CoverSession } from "@/lib/cover/types";

// Build the per-turn prompt for the cover-letter agent. The AI is STATELESS
// between turns: every turn it re-reads modes/cover.md and the candidate files,
// and the ONLY memory it has of this conversation is the serialized transcript
// we replay here. It follows cover.md's flow and content rules verbatim, with a
// single override — questions come back as a JSON envelope, not prose.

const SCHEMA = `Your ENTIRE output must be ONE JSON object (an "envelope"). No prose, no markdown, no code fence — the very first character is "{" and the very last is "}". It is one of three shapes:

1) Ask the user for input:
{
  "phase": "collect",
  "title": "<short heading, optional>",
  "intro": "<1-2 sentence context for this batch, optional>",
  "fields": [
    {
      "id": "<stable snake_case id, unique within this envelope>",
      "type": "text" | "textarea" | "single-select" | "multi-select" | "confirm",
      "label": "<the question>",
      "help": "<explanatory sub-text, optional>",
      "options": ["<opt>", ...],          // REQUIRED for single-select/multi-select
      "placeholder": "<optional>",
      "required": true | false,
      "allowCustom": true | false,        // adds an "Other — write your own" input to a select
      "default": "<prefilled text for text/textarea/confirm, optional>"
    }
  ]
}

2) Show the drafted letter for approval:
{
  "phase": "review",
  "title": "<optional>",
  "letterMarkdown": "<the FULL cover letter as markdown>",
  "note": "<optional post-draft note>"
}

3) Finished (only AFTER the PDF is rendered):
{
  "phase": "done",
  "letterMarkdown": "<the final letter as markdown, optional>",
  "pdfPath": "output/<company-slug>-<role-slug>-cover.pdf",
  "cvPdfPath": "<the generated CV pdf path, optional>",
  "note": "<Step 10 post-generation note: unincorporated keywords, gap handling, word count>"
}

Field-type guidance:
- "confirm" = an editable textarea prefilled with your "default" (e.g. the company-research synthesis or keyword list) that the user edits or accepts.
- "single-select" = mutually-exclusive choice (e.g. Tone). Use "allowCustom": true when the user may write their own (e.g. the "Why this role" angle).
- "multi-select" = several may apply.
- Batch related questions into ONE "collect" envelope where cover.md would ask them together (e.g. research-confirm + keywords + gaps + the four prompts can be several fields in a few envelopes — do not drip one question per turn).`;

function serializeTranscript(session: CoverSession): string {
  if (session.transcript.length === 0) return "(This is the FIRST turn — no prior exchange.)";
  const lines: string[] = [];
  for (const t of session.transcript) {
    if (t.role === "agent") {
      lines.push(`AGENT (you) emitted this envelope:\n${JSON.stringify(t.envelope)}`);
    } else {
      lines.push(`USER answered:\n${JSON.stringify(t.answers)}`);
    }
  }
  return lines.join("\n\n");
}

export function buildCoverPrompt(session: CoverSession): string {
  const cwd = careerOpsRoot();
  const today = new Date().toISOString().slice(0, 10);
  const mem = readMemory().trim();

  let sourceLine: string;
  if (session.reportNum) {
    const file = findReportFile(session.reportNum);
    const rel = file ? path.relative(cwd, file) : `reports/ (report #${session.reportNum})`;
    sourceLine = `This is SLUG MODE. The evaluation report for this application is \`${rel}\`. Read it for the job description, the posting URL (in its header), and its \`## Cover Letter Draft\` section — use that draft as a starting point per cover.md's "Slug mode specifics". After the PDF is generated, update that report's \`## Cover Letter Draft\` section with a "PDF generated: {path} on ${today}" note.`;
  } else {
    sourceLine = `This is PASTE MODE. The job description is provided below — treat it as the JD (cover.md Step 0):\n\n<job-description>\n${session.jd ?? ""}\n</job-description>`;
  }

  return `You are running career-ops COVER LETTER generation, HEADLESS, on the user's own machine. Your absolute Current Working Directory (CWD) is EXACTLY \`${cwd}\`. You MUST use this exact path for all tool calls and commands. Today is ${today}.

Follow \`modes/cover.md\` EXACTLY for the FLOW (Steps 0-10), the language rules, and the source-of-truth rules (content only from cv.md / config/profile.yml / modes/_profile.md / article-digest.md — never fabricate). Read modes/cover.md, config/profile.yml, cv.md, modes/_profile.md (and article-digest.md if present) before drafting.

ONE OVERRIDE to cover.md: you have NO chat. You never ask the user questions as prose. Instead, whenever cover.md tells you to present something to the user and wait (Step 3 research confirm, Step 4 keyword confirm, Step 5 gaps, Step 6 the four prompts, Step 8 draft approval), you STOP and emit a JSON envelope describing exactly what to collect, then end your turn. You will be re-invoked with the user's answers appended to the transcript.

${sourceLine}

On the FIRST turn: do the Step 3 company research (WebSearch) and JD parsing yourself, then emit your first "collect" envelope. You may batch Step 3/4/5/6 into a few envelopes rather than one giant one, but do NOT drip a single question per turn.

CRITICAL — you are STATELESS between turns. The transcript below is your ONLY memory of this conversation. Any fact you discovered (research synthesis, chosen keywords, gap decisions) MUST be carried forward by putting it into your envelope text (an intro, a field's help, or a "confirm" default), because next turn you will only see this transcript, not your own reasoning.

Draft the letter with "phase":"review" ONLY once you have all four Step-6 answers and any gap decisions. Generate the PDF (cover.md Step 9: write the JSON payload to /tmp/cover-payload-{company-slug}.json, then run \`node generate-cover-letter.mjs --payload /tmp/cover-payload-{company-slug}.json\`) ONLY after the user approves the reviewed draft. If the user's approval includes \`"regenerateCV": "true"\`, you MUST also generate a tailored CV PDF by strictly following \`modes/pdf.md\` (read it if needed), immediately after generating the cover letter PDF. Then emit "phase":"done" with the real output paths (use \`pdfPath\` for the cover letter and \`cvPdfPath\` for the CV). Never submit or send anything anywhere.

${SCHEMA}
${mem ? `\nDurable notes about the user (from their profile):\n${mem}\n` : ""}
=== TRANSCRIPT SO FAR ===
${serializeTranscript(session)}
=== END TRANSCRIPT ===

Now produce your next envelope. Output ONLY the JSON object.`;
}
