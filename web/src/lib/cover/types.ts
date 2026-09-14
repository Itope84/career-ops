// The structured contract for the interactive cover-letter modal.
//
// The AI, instead of asking the cover.md questions as prose, emits ONE
// `CoverEnvelope` per turn describing either the next batch of inputs to render
// (`collect`), the drafted letter to approve (`review`), or the finished result
// (`done`). The web UI renders each `CoverField` as a real input. The whole
// exchange is persisted to disk (see session.ts) so the user can leave and
// resume — the AI is stateless between turns and only ever sees the transcript.

export type CoverFieldType = "text" | "textarea" | "single-select" | "multi-select" | "confirm";

export type CoverField = {
  id: string;
  type: CoverFieldType;
  label: string;
  /** Explanatory sub-text under the label (e.g. the research synthesis to confirm). */
  help?: string;
  /** For single-select / multi-select. */
  options?: string[];
  placeholder?: string;
  required?: boolean;
  /** Adds an "Other — write your own" free-text input alongside the options. */
  allowCustom?: boolean;
  /** Prefill for text / textarea / confirm (e.g. an editable research synthesis). */
  default?: string;
};

export type CoverEnvelope =
  | { phase: "collect"; title?: string; intro?: string; fields: CoverField[] }
  | { phase: "review"; title?: string; letterMarkdown: string; note?: string }
  | { phase: "done"; letterMarkdown?: string; pdfPath?: string; cvPdfPath?: string; note?: string };

export type CoverStatus = "thinking" | "awaiting-input" | "review" | "done" | "error";

/** One transcript entry. Agent turns store the emitted envelope; user turns store
 *  the answers keyed by field id (a multi-select value is joined with " | "). */
export type CoverTurn =
  | { role: "agent"; envelope: CoverEnvelope }
  | { role: "user"; answers: Record<string, string> };

export type CoverSession = {
  id: string;
  /** Report number (e.g. "028") the letter is for, or null for pasted-JD mode. */
  reportNum: string | null;
  /** Pasted JD text (paste mode), or null when working from a report. */
  jd: string | null;
  company: string;
  cliId: string;
  createdAt: number;
  updatedAt: number;
  /** When the current in-flight turn began — used for the staleness guard. */
  startedAt: number;
  status: CoverStatus;
  transcript: CoverTurn[];
  /** What the UI renders now (a collect or review envelope), or null while thinking. */
  current: CoverEnvelope | null;
  result: { letterMarkdown?: string; pdfPath?: string; cvPdfPath?: string; note?: string } | null;
  error: string | null;
};

/** Runtime validation of a model-emitted envelope (never trust raw LLM JSON). */
export function coerceEnvelope(obj: unknown): CoverEnvelope | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const phase = o.phase;
  if (phase === "collect") {
    const rawFields = Array.isArray(o.fields) ? o.fields : [];
    const fields = rawFields.map(coerceField).filter((f): f is CoverField => f !== null);
    if (fields.length === 0) return null;
    return {
      phase: "collect",
      title: str(o.title),
      intro: str(o.intro),
      fields,
    };
  }
  if (phase === "review") {
    const letter = str(o.letterMarkdown);
    if (!letter) return null;
    return { phase: "review", title: str(o.title), letterMarkdown: letter, note: str(o.note) };
  }
  if (phase === "done") {
    return { phase: "done", letterMarkdown: str(o.letterMarkdown), pdfPath: str(o.pdfPath), cvPdfPath: str(o.cvPdfPath), note: str(o.note) };
  }
  return null;
}

const VALID_TYPES: CoverFieldType[] = ["text", "textarea", "single-select", "multi-select", "confirm"];

function coerceField(raw: unknown): CoverField | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const label = str(r.label);
  const type = r.type as CoverFieldType;
  if (!id || !label || !VALID_TYPES.includes(type)) return null;
  const options = Array.isArray(r.options) ? r.options.map(String).filter(Boolean) : undefined;
  // A select with no options is unusable — drop it rather than render an empty picker.
  if ((type === "single-select" || type === "multi-select") && (!options || options.length === 0)) return null;
  return {
    id,
    type,
    label,
    help: str(r.help),
    options,
    placeholder: str(r.placeholder),
    required: r.required === true,
    allowCustom: r.allowCustom === true,
    default: str(r.default),
  };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
