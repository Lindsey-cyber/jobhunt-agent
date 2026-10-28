// The candidate's approve/reject decisions, kept as a labeled eval set. Each
// label stores the evidence it was given on, so later rule changes are scored on
// exactly what the candidate saw. Pure.
import type { Job, Triage } from "../domain/job.ts";
import type { TriageInput } from "./triage.ts";

export interface Label {
  key: string;
  label: "fit" | "not_fit";
  at: string;
  // Who decided: only "candidate" labels count toward the eval score.
  by: "candidate";
  note: string;
  evidence: TriageInput & { company: string };
}

export const labelFrom = (j: Job, label: Label["label"], note: string, at: string): Label => ({
  key: j.key,
  label,
  at,
  by: "candidate",
  note,
  evidence: { company: j.company, title: j.title, location: j.location, description: j.description, official: j.official, hints: j.hints },
});

export interface EvalScore {
  n: number;
  // Of postings triage would show (match), the share the candidate wanted.
  precision: number | null;
  // Of postings the candidate wanted, the share triage would show.
  recall: number | null;
  // Wanted postings triage would hide outright (reject): the costly error.
  hiddenFits: number;
  reviews: number;
}

export function scoreEval(labels: Label[], judge: (e: TriageInput) => Triage): EvalScore {
  const latest = new Map(labels.map((l) => [l.key, l]));
  const rows = [...latest.values()].map((l) => ({ want: l.label === "fit", verdict: judge(l.evidence).verdict }));
  const shown = rows.filter((r) => r.verdict === "match");
  const wanted = rows.filter((r) => r.want);
  return {
    n: rows.length,
    precision: shown.length ? shown.filter((r) => r.want).length / shown.length : null,
    recall: wanted.length ? wanted.filter((r) => r.verdict === "match").length / wanted.length : null,
    hiddenFits: wanted.filter((r) => r.verdict === "reject").length,
    reviews: rows.filter((r) => r.verdict === "review").length,
  };
}

// A rule change ships only if it does not lower precision or recall and does
// not hide more wanted postings than the recorded baseline.
export function regressions(now: EvalScore, baseline: EvalScore): string[] {
  const out: string[] = [];
  const drop = (name: "precision" | "recall") => {
    const a = now[name], b = baseline[name];
    if (a != null && b != null && a + 1e-9 < b) out.push(`${name} fell from ${b.toFixed(3)} to ${a.toFixed(3)}`);
  };
  drop("precision");
  drop("recall");
  if (now.hiddenFits > baseline.hiddenFits) out.push(`wanted postings rejected rose from ${baseline.hiddenFits} to ${now.hiddenFits}`);
  return out;
}
