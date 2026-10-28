import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { FillPlan } from "../plan/plan.ts";
import { normalize } from "../plan/text.ts";
import type { Ledger } from "./ledger.ts";
import type { ReviewList } from "./review.ts";

// Reasons the candidate can settle with one answer reused on every form.
// Vetoed fields (compensation, references, signatures) are never collected:
// those stay on the form for the candidate.
const ANSWERABLE = /^(no answer in profile or answer bank|sensitive question with no exact answer|acknowledgements and consents need the candidate)$/;

export interface OpenQuestion {
  id: string;
  label: string;
  options: string[];
  jobs: string[];
}

export const questionId = (label: string) => `question:form:${createHash("sha1").update(normalize(label)).digest("hex").slice(0, 10)}`;

// Every required question that holds an application today, merged by wording.
export function openQuestions(ledger: Ledger): OpenQuestion[] {
  const byLabel = new Map<string, OpenQuestion>();
  for (const e of ledger.latest().filter((x) => x.state === "held")) {
    const planPath = join(e.runDir, "plan.json");
    if (!existsSync(planPath)) continue;
    const plan = JSON.parse(readFileSync(planPath, "utf8")) as FillPlan;
    for (const item of plan.items) {
      if (item.status !== "blocked" || !ANSWERABLE.test(item.reason)) continue;
      const id = questionId(item.field.label);
      const q = byLabel.get(id) ?? { id, label: item.field.label, options: item.field.options, jobs: [] };
      q.jobs.push(`${plan.form.company} · ${plan.form.jobTitle}`);
      byLabel.set(id, q);
    }
  }
  return [...byLabel.values()].sort((a, b) => b.jobs.length - a.jobs.length);
}

export function queueQuestions(ledger: Ledger, review: ReviewList): number {
  let added = 0;
  for (const q of openQuestions(ledger)) {
    review.refresh({
      id: q.id,
      kind: "question",
      subject: q.label,
      detail: `${q.options.length ? `Choices: ${q.options.join(" / ")}. ` : ""}Blocks ${q.jobs.length}: ${q.jobs.slice(0, 5).join("; ")}${q.jobs.length > 5 ? " …" : ""}`,
    });
    added++;
  }
  return added;
}
