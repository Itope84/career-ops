import fs from 'fs';
import yaml from 'js-yaml';

function generatePrompt() {
  let profileYaml;
  try {
    profileYaml = fs.readFileSync('config/profile.yml', 'utf8');
  } catch (e) {
    console.error("Could not read config/profile.yml", e);
    process.exit(1);
  }

  const profile = yaml.load(profileYaml);

  const archetypes = profile.target_roles.archetypes.map(a => `- ${a.name} (${a.level}): ${a.note}`).join('\n');
  const minComp = profile.compensation.minimum;
  const locationFlex = profile.compensation.location_flexibility;
  const visaStatus = profile.location.visa_status;

  const prompt = `You are an expert executive recruiter performing a rapid first-pass triage on a job description.
Your goal is to instantly reject jobs that are a fundamental mismatch for the candidate, saving time and API costs.

CANDIDATE TARGETS:
The candidate is targeting these specific archetypes. The job must align with at least one:
${archetypes}

HARD DEAL-BREAKERS (Reject if the JD violates ANY of these):
1. Location: ${locationFlex} (Reject if it is a US-only remote role).
2. Compensation: If a salary is explicitly stated and the MAXIMUM of their advertised band is strictly below ${minComp}, reject. (If the salary is unadvertised/undisclosed, DO NOT reject).
3. Visa/Sponsorship: ${visaStatus}. (Reject if the role explicitly requires existing right-to-work in a country other than the UK, e.g., "Must be a US Citizen").
4. False Friends / Skill Mismatch: Reject if the role is primarily quota-carrying B2B Sales (e.g. Account Executive), heavy software engineering (coding), or requires specialized licenses/certifications the candidate clearly lacks (e.g., medical, legal, chartered accounting).

INSTRUCTIONS:
You will be provided with a Job Description.
If the job violates ANY of the Hard Deal-Breakers, or if the core day-to-day responsibilities have absolutely zero overlap with the Candidate Targets, output "NO" followed by a 1-sentence reason.
If the job is a potential match, or if you do not have enough information to reject it, output "YES".

Output ONLY "YES" or "NO: [Reason]". Do not output any other text.`;

  console.log("=== GENERATED TRIAGE PROMPT ===\n");
  console.log(prompt);
}

generatePrompt();
