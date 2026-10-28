import type { Config } from "../profile/schema.ts";
import { GREEN, type FillPlan } from "../plan/plan.ts";
import type { VerifyReport } from "../verify/compare.ts";

export type GateDecision = { decision: "submit" } | { decision: "hold"; reasons: string[] };

export interface GateInput {
  plan: FillPlan;
  verify: VerifyReport;
  config: Config;
  submittedToday: number;
  approved: boolean;
  // Things on the page no approval lifts, e.g. a captcha the agent must not solve.
  blockers?: string[];
}

// `approved` is a human who reviewed this run's evidence: it lifts the trust and
// confidence checks, never a blocked field, a failed readback or the daily cap.
export function gate({ plan, verify, config, submittedToday, approved, blockers = [] }: GateInput): GateDecision {
  const reasons: string[] = [...blockers];
  if (!approved && config.trust === "draft") reasons.push("trust level is draft: every application waits for review");
  if (!approved && !config.autoSubmitAts.includes(plan.form.ats)) reasons.push(`${plan.form.ats} is not in autoSubmitAts`);
  if (submittedToday >= config.dailySubmitCap) reasons.push(`daily cap of ${config.dailySubmitCap} reached`);

  for (const item of plan.items) {
    if (item.status === "blocked") reasons.push(`required "${item.field.label}": ${item.reason}`);
    if (item.status !== "fill") continue;
    if (!approved && item.confidence < GREEN) reasons.push(`low confidence (${item.confidence.toFixed(2)}) on "${item.field.label}"`);
    if (!approved && item.source.type === "bank" && item.source.origin === "generated" && !config.allowGeneratedAnswers) {
      reasons.push(`"${item.field.label}" uses a generated answer that has not been approved`);
    }
  }

  for (const c of verify.checks) if (!c.pass) reasons.push(`readback mismatch on "${c.label}": expected "${c.expected}", got "${c.actual}"`);
  for (const label of verify.emptyRequired) reasons.push(`required "${label}" is empty after filling`);

  return reasons.length === 0 ? { decision: "submit" } : { decision: "hold", reasons };
}
