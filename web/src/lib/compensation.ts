/**
 * Compensation — ONE canonical source, every display string derived.
 *
 * THE BUG THIS EXISTS TO KILL
 * ---------------------------
 * A salary floor used to live in seven places: `compensation.target_range`,
 * `compensation.minimum`, two `markets[].target_range`, two
 * `markets[].minimum`, and `portals.yml`'s `salary_filter.min`. The profile
 * editor wrote exactly one of them (`target_range`) — and `target_range` is
 * the one nothing decides on. So changing the number in the UI moved a label
 * and left every actual gate untouched: triage and scoring kept reading the
 * old `minimum`, and the scanner kept dropping postings at the old
 * `salary_filter.min`.
 *
 * So: three numbers are canonical, everything else is generated from them.
 *
 *   cutoff     the hard floor — the ONLY number any gate reads
 *   rangeMin   bottom of the advertised target, for display/narrative
 *   rangeMax   top of it; 0 or null means open-ended ("€35k+")
 *
 * WHERE EACH ONE LANDS
 * --------------------
 *   cutoff   → compensation.minimum, every markets[].minimum,
 *              portals.yml salary_filter.min
 *   range    → compensation.target_range, every markets[].target_range
 *
 * `salary_filter.max` is DELIBERATELY never derived from rangeMax. In
 * scan.mjs (`buildSalaryFilter`) max is an UPPER bound — postings paying more
 * than it are filtered out — so wiring a target-range ceiling into it would
 * silently discard the best-paying roles in the pipeline. It stays 0
 * ("no upper limit") unless a human sets it by hand.
 */

export type CompensationInput = {
  cutoff: number | null;
  rangeMin: number | null;
  rangeMax: number | null;
  currency: string;
};

const SYMBOLS: Record<string, string> = { EUR: "€", GBP: "£", USD: "$" };

export function currencySymbol(currency: string): string {
  return SYMBOLS[(currency || "").trim().toUpperCase()] ?? "";
}

/** "€35,000" — the long form used by `minimum`, which the prompts quote verbatim. */
export function formatMoney(n: number, currency: string): string {
  return `${currencySymbol(currency)}${Math.round(n).toLocaleString("en-US")}`;
}

/** "€35k" — the short form used in range labels. Keeps a half (€37.5k) rather
 *  than rounding it away, since those bands do occur. */
export function formatShort(n: number, currency: string): string {
  const k = n / 1000;
  const num = Number.isInteger(k) ? String(k) : k.toFixed(1).replace(/\.0$/, "");
  return `${currencySymbol(currency)}${num}k`;
}

/**
 * Read a number back out of whatever string the profile already holds, so an
 * existing profile.yml upgrades itself on first save instead of needing a
 * hand migration. Handles "€35,000", "€35k+", "35K equivalent", "£40,000".
 * Returns null when there is no confident number — never a guess.
 */
export function parseMoney(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw > 0 ? raw : null;
  if (typeof raw !== "string") return null;
  const m = raw.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([kK])?/);
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (m[2]) n *= 1000;
  // A bare "35" in a salary field means 35k, not €35 — but only up to a
  // threshold, so a real 35000 is never multiplied twice.
  if (n < 1000) n *= 1000;
  return n;
}

/** The display band: "€35k–€45k", or "€35k+" when open-ended. */
export function formatRange(min: number | null, max: number | null, currency: string): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null && max > min) return `${formatShort(min, currency)}–${formatShort(max, currency)}`;
  const only = min ?? max;
  return only == null ? null : `${formatShort(only, currency)}+`;
}

/**
 * Pull the canonical three out of an existing `compensation` block, falling
 * back to parsing the legacy display strings when the numeric keys are absent.
 */
export function readCompensation(comp: Record<string, unknown> | undefined): CompensationInput {
  const c = comp ?? {};
  const currency = typeof c.currency === "string" && c.currency.trim() ? c.currency.trim() : "EUR";
  return {
    cutoff: parseMoney(c.cutoff) ?? parseMoney(c.minimum),
    rangeMin: parseMoney(c.range_min) ?? parseMoney(c.target_range),
    rangeMax: parseMoney(c.range_max),
    currency,
  };
}

/**
 * Apply the canonical three to a whole `compensation` block, in place of the
 * scattered edits that used to be needed. Everything not derived —
 * `location_flexibility`, `when_unadvertised`, each market's `notes` and
 * `market` name — is preserved untouched.
 *
 * Per-market strings keep an existing " equivalent" suffix: the UK market
 * records a euro-equivalent floor, and flattening that to a bare "€35,000"
 * would assert a GBP figure the candidate never stated.
 */
export function applyCompensation(
  comp: Record<string, unknown> | undefined,
  input: CompensationInput,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(comp ?? {}) };
  const { cutoff, rangeMin, rangeMax, currency } = input;

  out.currency = currency;
  if (cutoff != null) out.cutoff = cutoff;
  if (rangeMin != null) out.range_min = rangeMin;
  if (rangeMax != null) out.range_max = rangeMax;
  else delete out.range_max;

  const minimumStr = cutoff != null ? formatMoney(cutoff, currency) : null;
  const rangeStr = formatRange(rangeMin, rangeMax, currency);
  if (minimumStr) out.minimum = minimumStr;
  if (rangeStr) out.target_range = rangeStr;

  if (Array.isArray(out.markets)) {
    out.markets = (out.markets as unknown[]).map((m) => {
      if (!m || typeof m !== "object") return m;
      const market = { ...(m as Record<string, unknown>) };
      const keepEquivalent = (prev: unknown, next: string) =>
        typeof prev === "string" && /equivalent/i.test(prev) ? `${next} equivalent` : next;
      if (minimumStr) market.minimum = keepEquivalent(market.minimum, minimumStr);
      if (rangeStr) market.target_range = keepEquivalent(market.target_range, rangeStr);
      return market;
    });
  }
  return out;
}
