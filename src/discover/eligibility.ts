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

export function eligibility({ job, label, h1b, policy, payFloor, today }: EligibilityInput): Eligibility {
  const reasons: string[] = [];
  const ats = job.key.split(":")[0]!;
  if (label === "not_fit") reasons.push("you marked it not to apply");
  else if (label !== "fit" && job.triage.verdict !== "match") reasons.push(`not a match (${job.triage.rule})`);
  const ex = excludedBy(job.company, policy.excludeCompanies);
  if (ex) reasons.push(`excluded company (${ex})`);
  if (policy.excludeSeniorTitles && tooSenior(job.title)) reasons.push("senior title");
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - policy.windowDays * 86400000).toISOString().slice(0, 10);
  const posted = postedOn(job);
  if (!posted || posted < since) reasons.push(`posted ${posted || "on an unknown date"}, before ${since}`);
  if (policy.h1bRequiredSince !== null) {
    const v = sponsorVerdict(h1b);
    if (v === "none") reasons.push(`no H-1B filings since ${policy.h1bRequiredSince}`);
    if (v === "unknown") reasons.push("H-1B history not looked up yet");
  }
  if (job.link?.status === "invalid") reasons.push("posting closed");
  if (payFloor && payBelowExpectation(job.description ?? "", payFloor)) reasons.push("pay tops out below her range");
  return { ok: reasons.length === 0, lane: policy.agentAts.includes(ats) ? "agent" : "you", reasons };
}

// Apply order: fit tier (A, B, C) when a scorer is given, then titles the policy puts last, then newest first.
export function applyOrder<T extends Pick<Job, "title" | "publishedAt" | "firstSeen">>(jobs: T[], policy: Policy, tierOf?: (j: T) => "A" | "B" | "C"): T[] {
  const last = (j: T) => (policy.applyLast.some((t) => j.title.toLowerCase().includes(t.toLowerCase())) ? 1 : 0);
  const tier = (j: T) => (tierOf ? tierOf(j) : "A");
  return [...jobs].sort((a, b) => tier(a).localeCompare(tier(b)) || last(a) - last(b) || postedOn(b).localeCompare(postedOn(a)));
}
