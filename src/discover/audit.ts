// Triage audit. Code draws a stratified sample and hides the verdicts; an
// independent auditor (another model or prompt, reading only the evidence)
// judges each item; code scores the judgments against the hidden verdicts.
import type { Job, Verdict } from "../domain/job.ts";
import type { Profile } from "../profile/schema.ts";
import { ROLE } from "./triage.ts";

export type Stratum = "match" | "reject_near" | "reject_any" | "review";

export interface BlindItem {
  id: string;
  company: string;
  title: string;
  location: string;
  url: string;
  officialPosting: boolean;
  description: string;
  sourceNotes: string[];
}

export interface AnswerKeyItem {
  id: string;
  key: string;
  stratum: Stratum;
  verdict: Verdict;
  rule: string;
}

export interface AuditVerdict {
  id: string;
  fit: "yes" | "no" | "unsure";
  reason: string;
}

// Deterministic PRNG so a sample can be redrawn from its seed.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function take<T>(xs: T[], n: number, rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, n);
}

export const AUDIT_PLAN: Record<Stratum, number> = { match: 40, reject_near: 30, reject_any: 20, review: 20 };

// "reject_near" are rejects whose title still looks like AI/ML work: where a
// wrong rule costs the candidate a real opening. "reject_any" is uniform over
// all rejects and is what the miss-rate estimate uses.
export function drawSample(jobs: Job[], seed: number, plan = AUDIT_PLAN): { blind: BlindItem[]; key: AnswerKeyItem[] } {
  const rand = rng(seed);
  // Exclusions are the candidate's preference, not a rule the auditor can judge.
  const open = jobs.filter((j) => !j.key.startsWith("lead:") && !j.hints.closed && j.triage.rule !== "company.excluded");
  const pools: Record<Stratum, Job[]> = {
    match: open.filter((j) => j.triage.verdict === "match"),
    reject_near: open.filter((j) => j.triage.verdict === "reject" && ROLE.test(j.title)),
    reject_any: open.filter((j) => j.triage.verdict === "reject"),
    review: open.filter((j) => j.triage.verdict === "review"),
  };
  const used = new Set<string>();
  const picked: { stratum: Stratum; job: Job }[] = [];
  for (const stratum of Object.keys(plan) as Stratum[]) {
    for (const job of take(pools[stratum].filter((j) => !used.has(j.key)), plan[stratum], rand)) {
      used.add(job.key);
      picked.push({ stratum, job });
    }
  }
  const shuffled = take(picked, picked.length, rand);
  const blind = shuffled.map(({ job }, i) => ({
    id: `a${String(i + 1).padStart(3, "0")}`,
    company: job.company,
    title: job.title,
    location: job.location,
    url: job.url,
    officialPosting: job.official,
    description: job.description.slice(0, 3500),
    sourceNotes: [...new Set(job.sources.map((s) => (s.official ? "official ATS board" : s.channel.startsWith("github") ? "listed on a new-grad GitHub list" : s.channel.replace("_", " "))))],
  }));
  const key = shuffled.map(({ stratum, job }, i) => ({ id: blind[i]!.id, key: job.key, stratum, verdict: job.triage.verdict, rule: job.triage.rule }));
  return { blind, key };
}

export interface AuditScore {
  judged: number;
  unsure: number;
  // Of matches the auditor could judge, the share it says are not a fit (误筛率).
  falseMatchRate: number | null;
  matchJudged: number;
  // Of uniformly sampled rejects, the share it says are a fit (漏筛率).
  missRate: number | null;
  rejectJudged: number;
  // Same over near-miss rejects: an upper bound that shows which rules leak.
  nearMissRate: number | null;
  nearJudged: number;
  // Reviews the auditor would send each way.
  reviewFit: number;
  reviewNotFit: number;
  byRule: Record<string, { judged: number; disagree: number }>;
  disagreements: (AnswerKeyItem & AuditVerdict)[];
}

export function scoreAudit(key: AnswerKeyItem[], verdicts: AuditVerdict[]): AuditScore {
  const byId = new Map(verdicts.map((v) => [v.id, v]));
  const rows = key.filter((k) => k.rule !== "company.excluded").flatMap((k) => (byId.get(k.id) ? [{ ...k, ...byId.get(k.id)! }] : []));
  const judged = rows.filter((r) => r.fit !== "unsure");
  const rate = (xs: typeof judged, bad: (r: (typeof judged)[number]) => boolean) => (xs.length ? xs.filter(bad).length / xs.length : null);
  const disagrees = (r: (typeof rows)[number]) => (r.verdict === "match" && r.fit === "no") || (r.verdict === "reject" && r.fit === "yes");
  const byRule: AuditScore["byRule"] = {};
  for (const r of judged.filter((x) => x.verdict !== "review")) {
    const b = (byRule[r.rule] ??= { judged: 0, disagree: 0 });
    b.judged++;
    if (disagrees(r)) b.disagree++;
  }
  const m = judged.filter((r) => r.stratum === "match");
  const a = judged.filter((r) => r.stratum === "reject_any");
  const n = judged.filter((r) => r.stratum === "reject_near");
  return {
    judged: judged.length,
    unsure: rows.length - judged.length,
    falseMatchRate: rate(m, (r) => r.fit === "no"),
    matchJudged: m.length,
    missRate: rate(a, (r) => r.fit === "yes"),
    rejectJudged: a.length,
    nearMissRate: rate(n, (r) => r.fit === "yes"),
    nearJudged: n.length,
    reviewFit: judged.filter((r) => r.stratum === "review" && r.fit === "yes").length,
    reviewNotFit: judged.filter((r) => r.stratum === "review" && r.fit === "no").length,
    byRule,
    disagreements: rows.filter(disagrees),
  };
}

// The auditor's instructions. Deliberately a different framing from the rules:
// it reads the posting as a recruiter would, knowing only the candidate's facts,
// which come from the profile like everything else.
export function auditorBrief(p: Profile): string {
  const degrees = p.education.map((e) => `${e.degree} in ${e.major} (${e.school}, ${e.gradYear}-${String(e.gradMonth).padStart(2, "0")})`).join("; ");
  const phd = p.education.some((e) => /ph\.?d|doctor/i.test(e.degree));
  const auth = p.workAuthorization.authorizedCountries.join(", ");
  return `You are auditing a job-search filter for one candidate. You see job postings only; you do not see what the filter decided.

Candidate: ${degrees}.${phd ? "" : " No PhD."} Looking for a first full-time role: New Grad, entry-level, or up to 2 years of experience. Target: AI/ML roles: machine learning engineer, AI engineer, applied or research scientist or research engineer roles that accept the candidate's degree, ML or data infrastructure and data engineering, data scientist roles (with or without ML in the title) and AI or data analyst roles. Wants a job in: ${auth}. ${p.workAuthorization.needsSponsorship ? "Needs visa sponsorship." : "Does not need sponsorship."} Citizenship: ${p.citizenship.join(", ")}. Full-time only (no internships).

For each posting answer "yes" if the candidate should see it as a fitting opening to apply to, "no" if not, "unsure" only when the evidence given truly cannot decide it (for example no description and an ambiguous title). Judge only from the text given. Missing information about sponsorship is NOT a reason to say no; an explicit statement that the employer will not sponsor is. Requirements stated as preferred are not disqualifying. Only an explicitly required minimum of 3 or more years of experience disqualifies; "2+ years" or "experienced" without a number does not. A posting outside ${auth} is a no.

${p.newGradCohorts.length ? `New-grad postings for the graduating classes of ${p.newGradCohorts.join(" or ")} count as fitting even when the candidate's own graduation date falls outside the stated window; she applies to them on purpose. ` : ""}A required degree "in Computer Science or a related field" (or in a quantitative or technical field) includes her degrees; only an explicit requirement she does not meet (a PhD, a specific engineering degree with no "related field") disqualifies. An explicit statement that the role does not sponsor visas, requires U.S. citizenship or a security clearance, is contract-only, or is not open to new graduates is a no.

Give a one-sentence reason quoting the decisive words.`;
}
