// One answer to "should this posting be applied to?", from the candidate's policy
// (data/policy.yaml). Every stage asks this function; none filters on its own.
import type { Job } from "../domain/job.ts";
import type { Policy } from "../profile/schema.ts";
import { excludedBy } from "./exclude.ts";
import { sponsorVerdict, type H1bRecord } from "./h1b.ts";
import { payBelowExpectation } from "./pay.ts";
import { tooSenior } from "./seniority.ts";

export interface Eligibility {
  ok: boolean;
  // Who applies when ok: the agent on its ATS, the candidate on the rest.
  lane: "agent" | "you";
  // Why not, one line each (empty when ok).
  reasons: string[];
}

export interface EligibilityInput {
  job: Pick<Job, "key" | "company" | "title" | "description" | "publishedAt" | "firstSeen" | "triage"> & { link?: { status?: string } };
  // The candidate's label, if any: fit approves, not_fit vetoes.
  label?: "fit" | "not_fit" | undefined;
  h1b?: H1bRecord | undefined;
  policy: Policy;
  payFloor?: number | undefined;
  today: string; // YYYY-MM-DD
}

export const postedOn = (j: Pick<Job, "publishedAt" | "firstSeen">): string => (j.publishedAt || j.firstSeen || "").slice(0, 10);

// The first day that still counts as fresh: age orders applying, it never excludes (2026-11-02).
export const freshSince = (policy: Pick<Policy, "freshDays">, today: string): string =>
  new Date(Date.parse(`${today}T00:00:00Z`) - policy.freshDays * 86400000).toISOString().slice(0, 10);

// Posted within the policy's fresh window. An unknown date is not fresh.
export const isFresh = (j: Pick<Job, "publishedAt" | "firstSeen">, policy: Pick<Policy, "freshDays">, today: string): boolean => {
  const posted = postedOn(j);
  return posted !== "" && posted >= freshSince(policy, today);
};

export function eligibility({ job, label, h1b, policy, payFloor, today }: EligibilityInput): Eligibility {
  const reasons: string[] = [];
  const ats = job.key.split(":")[0]!;
  if (label === "not_fit") reasons.push("you marked it not to apply");
  else if (label !== "fit" && job.triage.verdict !== "match") reasons.push(`not a match (${job.triage.rule})`);
  const ex = excludedBy(job.company, policy.excludeCompanies);
  if (ex) reasons.push(`excluded company (${ex})`);
  const title = policy.excludeTitles.find((t) => job.title.toLowerCase().includes(t.toLowerCase()));
  if (title) reasons.push(`excluded title (${title})`);
  if (policy.excludeSeniorTitles && tooSenior(job.title)) reasons.push("senior title");
  if (policy.h1bRequiredSince !== null) {
    const v = sponsorVerdict(h1b);
    if (v === "none") reasons.push(`no H-1B filings since ${policy.h1bRequiredSince}`);
    if (v === "unknown") reasons.push("H-1B history not looked up yet");
  }
  if (job.link?.status === "invalid") reasons.push("posting closed");
  if (payFloor && payBelowExpectation(job.description ?? "", payFloor)) reasons.push("pay tops out below her range");
  return { ok: reasons.length === 0, lane: policy.agentAts.includes(ats) ? "agent" : "you", reasons };
}

// Apply order: fresh postings before older ones, then fit tier (A, B, C) when a scorer is given, then newest first.
export function applyOrder<T extends Pick<Job, "publishedAt" | "firstSeen">>(jobs: T[], policy: Pick<Policy, "freshDays">, today: string, tierOf?: (j: T) => "A" | "B" | "C"): T[] {
  const stale = (j: T) => (isFresh(j, policy, today) ? 0 : 1);
  const tier = (j: T) => (tierOf ? tierOf(j) : "A");
  return [...jobs].sort((a, b) => stale(a) - stale(b) || tier(a).localeCompare(tier(b)) || postedOn(b).localeCompare(postedOn(a)));
}
