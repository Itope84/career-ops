import fs from 'fs';
import yaml from 'js-yaml';

function loadProfile() {
  let profileYaml;
  try {
    profileYaml = fs.readFileSync('config/profile.yml', 'utf8');
  } catch (e) {
    console.error("Could not read config/profile.yml", e);
    process.exit(1);
  }
  return yaml.load(profileYaml);
}

/**
 * The candidate's own excluded-title list from portals.yml — the SAME list
 * scan.mjs filters on, so triage and the scanner can't disagree about what
 * counts as an obvious no. Absent/malformed portals.yml → empty, and the
 * clause that uses it is simply omitted.
 */
function loadExcludedTitles() {
  try {
    const parsed = yaml.load(fs.readFileSync('portals.yml', 'utf8'));
    const neg = parsed?.title_filter?.negative;
    if (!Array.isArray(neg)) return [];
    return neg.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim());
  } catch {
    return [];
  }
}

/**
 * The cached JD digest for one posting id (the id IS the url), or null.
 *
 * Loaded lazily and defensively: jd-capture.mjs is new, so a fork that hasn't
 * copied it yet, or a checkout with an empty cache, must still produce a valid
 * title-only prompt rather than crash.
 */
let jdCapture = null;
async function loadJdCapture() {
  try {
    jdCapture = await import('./jd-capture.mjs');
  } catch {
    jdCapture = null; // sibling script absent (partial copy into another fork)
  }
}
function jdSummaryFor(url) {
  if (!jdCapture) return null;
  try {
    const jd = jdCapture.readJd(url);
    return jd ? jdCapture.summarizeJd(jd.text) : null;
  } catch {
    return null;
  }
}

/**
 * Language deal-breaker, CONSTRUCTED from `language.spoken` in profile.yml.
 *
 * Job titles very often carry the requirement outright ("French Speaker",
 * "Digital Marketing Specialist - Dutch", "German-speaking"), so this is one
 * of the few hard disqualifiers that IS reliably decidable from a title
 * alone — which is exactly what this title-only triage pass can act on.
 *
 * Returns null when `language.spoken` is absent, so the rule is simply
 * omitted rather than guessed at. NOTE it reads `language.spoken`, never
 * `language.output` — that one is the report-writing language (see AGENTS.md)
 * and says nothing about what the candidate actually speaks.
 */
function languageRule(profile) {
  const spoken = profile?.language?.spoken;
  const list = (Array.isArray(spoken) ? spoken : typeof spoken === 'string' ? [spoken] : [])
    .filter((l) => typeof l === 'string' && l.trim())
    .map((l) => l.trim());
  if (list.length === 0) return null;
  return `- Languages: the candidate speaks ${list.join(', ')}. Discard any posting that requires working fluency in a language outside that list — this is usually stated right in the title (e.g. "French Speaker", "- Dutch", "German-speaking"). Say which language in the reason.`;
}

/**
 * Seniority deal-breaker, CONSTRUCTED per instance — never hardcoded.
 *
 * This script is system-layer: it gets copied to every career-ops fork, whose
 * candidates sit at opposite ends of the seniority range. A literal
 * "reject Manager/Senior/Director" would be correct for a graduate-level
 * profile and actively destructive for a senior one (it would reject exactly
 * what that candidate is looking for). So the band is read from whatever
 * `target_roles.archetypes[].level` says in THIS instance's profile.yml.
 *
 * Two deliberate safety properties:
 *  - No levels declared → returns null and the rule is omitted entirely.
 *    Never invent a default band.
 *  - Scoped to ABOVE the band only. The "too junior" direction is left to
 *    each instance's own title_filter.negative (which is where a senior
 *    profile already declares "Junior"), so this rule can't surprise a fork
 *    by rejecting downward on its own initiative.
 */
function seniorityRule(profile) {
  const levels = [
    ...new Set(
      (profile?.target_roles?.archetypes ?? [])
        .map((a) => a?.level)
        .filter((l) => typeof l === 'string' && l.trim())
        .flatMap((l) => l.split('/').map((s) => s.trim()))
        .filter(Boolean),
    ),
  ];
  if (levels.length === 0) return null;

  let rule = `- Level: targeting ${levels.join(', ')}. Discard titles clearly ABOVE that band (e.g. Manager/Head/Director when the band tops out at Coordinator/Executive). Do not discard for being below it.`;
  const excluded = loadExcludedTitles();
  if (excluded.length > 0) {
    rule += `\n- Never keep a title containing: ${excluded.join(', ')}.`;
  }
  return rule;
}

/** The deal-breaker rules — single source of truth for both prompt modes below. */
function dealBreakers(profile) {
  const seniority = seniorityRule(profile);
  const language = languageRule(profile);
  const archetypes = profile.target_roles.archetypes.map(a => `- ${a.name} (${a.level}): ${a.note}`).join('\n');
  const minComp = profile.compensation.minimum;
  const locationFlex = profile.compensation.location_flexibility;
  const visaStatus = profile.location.visa_status;
  // The country the candidate can ALREADY work in without sponsorship, from
  // this instance's own profile. Previously both parentheticals below hardcoded
  // the UK, which silently inverted the rule for a non-UK candidate: an
  // Ireland-based candidate was told to reject right-to-work requirements
  // "other than the UK", i.e. UK-only roles — the very ones needing sponsorship
  // — were explicitly PROTECTED from rejection, contradicting the
  // location_flexibility/visa_status prose sitting right next to it.
  const homeCountry = profile.location?.country || 'the candidate\'s home country';
  return `CANDIDATE TARGETS:
The candidate is targeting these specific archetypes. The job must align with at least one:
${archetypes}

HARD DEAL-BREAKERS (Reject if the JD violates ANY of these):
1. Location: ${locationFlex} (Reject if the role is remote but restricted to a country the line above does not allow.)
2. Compensation: If a salary is explicitly stated and the MAXIMUM of their advertised band is strictly below ${minComp}, reject. (If the salary is unadvertised/undisclosed, DO NOT reject).
3. Visa/Sponsorship: ${visaStatus}. The candidate can work WITHOUT sponsorship in ${homeCountry} only. Reject if the role requires existing right-to-work / citizenship in any OTHER country (e.g. "Must have the right to work in the US", "Must be a US Citizen") UNLESS the posting says sponsorship is offered/available. Treat silence on sponsorship for a role outside ${homeCountry} as "no sponsorship", and reject.
4. False Friends / Skill Mismatch: Reject if the role is primarily quota-carrying B2B Sales (e.g. Account Executive), heavy software engineering (coding), or requires specialized licenses/certifications the candidate clearly lacks (e.g., medical, legal, chartered accounting).${language ? `\n${language}` : ''}${seniority ? `\n${seniority}` : ''}`;
}

function generatePrompt() {
  const profile = loadProfile();
  const prompt = `You are an expert executive recruiter performing a rapid first-pass triage on a job description.
Your goal is to instantly reject jobs that are a fundamental mismatch for the candidate, saving time and API costs.

${dealBreakers(profile)}

INSTRUCTIONS:
You will be provided with a Job Description.
If the job violates ANY of the Hard Deal-Breakers, or if the core day-to-day responsibilities have absolutely zero overlap with the Candidate Targets, output "NO" followed by a 1-sentence reason.
If the job is a potential match, or if you do not have enough information to reject it, output "YES".

Output ONLY "YES" or "NO: [Reason]". Do not output any other text.`;

  console.log("=== GENERATED TRIAGE PROMPT ===\n");
  console.log(prompt);
}

/**
 * Batch mode — one prompt judging many jobs at once instead of one JD per
 * call. Added for the web app's Quick Triage (#web-triage-rework): the old
 * per-job round trip meant 137 separate model calls, each re-paying the full
 * deal-breaker preamble. This is the same rules, applied to a numbered list
 * of {id, company, role, location}, each carrying a one-line JD digest when
 * jd-capture.mjs cached one for it at scan time.
 *
 * That digest is why triage can now catch a body-only disqualifier — "4+
 * years' experience", "French Speaker", a second location the title never
 * mentions. It costs nothing per job: the text was captured once during the
 * scan and the digest is pure regex, so this stays the cheap pass it is
 * supposed to be. Postings cached before JD capture existed have no digest and
 * degrade to the old title-only line.
 *
 * Reads a JSON array from stdin: [{id, company, role, location}, ...].
 * Prints the prompt, ending with that same list rendered for the model.
 */
async function generateBatchPrompt() {
  await loadJdCapture();
  const profile = loadProfile();
  let items;
  try {
    items = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch (e) {
    console.error('generate-triage-prompt.mjs --batch: expected a JSON array of {id, company, role, location} on stdin —', e.message);
    process.exit(1);
  }
  if (!Array.isArray(items) || items.length === 0) {
    console.error('generate-triage-prompt.mjs --batch: input array is empty');
    process.exit(1);
  }

  // A cached JD summary (jd-capture.mjs, written at scan time) is folded in
  // when there is one. This is what lets triage catch "4+ years' experience"
  // or "French Speaker" in the BODY — titles lie, and a title-only pass had no
  // way to see either. Postings scanned before JD capture existed simply have
  // no summary and fall back to the title-only line, so the two mix safely.
  const listing = items
    .map((it, i) => {
      const head = `${i + 1}. id="${it.id}" | ${it.company || 'Unknown'} | ${it.role || 'Unknown'} | ${it.location || 'Unknown'}`;
      const summary = jdSummaryFor(it.id);
      return summary ? `${head}\n   JD: ${summary}` : head;
    })
    .join('\n');

  // DELIBERATELY LEAN — measured, not stylistic. The first version of this
  // prompt carried the full deal-breaker prose plus every archetype's
  // explanatory `note`, and it made the model chew CPU for 4+ minutes and
  // return NOTHING for a 5-posting batch (it blew /api/triage's timeout, and
  // every posting then fell through to the "keep" fail-safe — which is why a
  // real run reported "0 flagged of 20" without the model ever deciding
  // anything). The same batch with a terse prompt answers correctly in ~5s.
  // So: names and levels, not prose; short rules, not paragraphs. Everything
  // here is still CONSTRUCTED from this instance's own profile.yml — no
  // candidate-specific text is hardcoded, so it stays correct when this
  // system-layer script is copied to another career-ops fork.
  const archetypes = (profile?.target_roles?.archetypes ?? [])
    .map((a) => `${a.name}${a.level ? ` (${a.level})` : ''}`)
    .join('; ');
  const minComp = profile?.compensation?.minimum;
  const locationFlex = profile?.compensation?.location_flexibility;
  const seniority = seniorityRule(profile);

  const rules = [
    archetypes ? `- Target roles: ${archetypes}.` : null,
    locationFlex ? `- Location: ${locationFlex}` : null,
    minComp ? `- Pay: discard only if an advertised maximum is clearly below ${minComp}; undisclosed pay is NOT a reason to discard.` : null,
    '- Discard quota-carrying B2B sales, software engineering, or roles needing a licence the candidate lacks (medical, legal, chartered accounting).',
    languageRule(profile),
    seniority,
  ]
    .filter(Boolean)
    .join('\n');

  const prompt = `Triage these job postings for one candidate. Decide "keep" or "discard" for each.
Each posting gives company, role and location; some also carry a "JD:" line digested from the posting body — when present it outranks the title, which is often misleading.

${rules}

Discard anything clearly outside the target roles or above the target level. Keep anything plausibly within them.

Postings:
${listing}

Output ONLY a JSON array, nothing else — no fences, no commentary:
[{"id":"<id>","decision":"keep|discard","reason":"<short, required for discard>"}]`;

  console.log(prompt);
}

if (process.argv.includes('--batch')) {
  await generateBatchPrompt();
} else {
  generatePrompt();
}
