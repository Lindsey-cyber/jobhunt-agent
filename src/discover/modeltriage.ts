// A model's judgment on the postings the rules leave at "review" (no clear
// entry-level signal, research roles of unclear scope...). Applied after the
// rules and before exclusions: a "yes" makes the posting a match, a "no" a
// reject, "unsure" leaves it for the candidate. A verdict counts only for the
// text it judged (basis), so a changed posting is judged again. The blind audit
// samples these matches like any other, so their error rate is measured.
import type { Job, Triage } from "../domain/job.ts";

export interface ModelVerdict {
  key: string;
  fit: "yes" | "no" | "unsure";
  reason: string;
  basis: string;
  model: string;
  at: string;
}

// FNV-1a over what the model read.
export function basisOf(j: Pick<Job, "title" | "location" | "description">): string {
  let h = 0x811c9dc5;
  for (const ch of `${j.title}\n${j.location}\n${j.description}`) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// Postings a model may judge: rule verdict "review", openable, not a bare lead.
export const needsModel = (j: Job, v: ModelVerdict | undefined) =>
  j.triage.verdict === "review" && !j.key.startsWith("lead:") && !j.hints.closed && (!v || v.basis !== basisOf(j));

export function applyModelVerdict(j: Job, v: ModelVerdict | undefined): Triage {
  if (j.triage.verdict !== "review" || !v || v.basis !== basisOf(j) || v.fit === "unsure") return j.triage;
  return v.fit === "yes"
    ? { verdict: "match", rule: "model.fit", reason: `Model triage (${j.triage.rule}): ${v.reason}` }
    : { verdict: "reject", rule: "model.not_fit", reason: `Model triage (${j.triage.rule}): ${v.reason}` };
}
