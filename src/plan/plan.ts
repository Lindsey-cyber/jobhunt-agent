import type { FormField, FormSnapshot } from "../domain/form.ts";
import type { AnswerBank, AnswerEntry, Profile } from "../profile/schema.ts";
import { jobCountry, PROFILE_RULES, RESUME, SENSITIVE, VETO, type RuleContext } from "./rules.ts";
import { jaccard, matchOption, normalize } from "./text.ts";

export type Source =
  | { type: "profile"; path: string }
  | { type: "bank"; id: string; origin: AnswerEntry["origin"] }
  | { type: "file"; path: string };

export type PlanItem =
  | { status: "fill"; field: FormField; value: string; source: Source; confidence: number; sensitive: boolean }
  | { status: "skip"; field: FormField; reason: string }
  | { status: "blocked"; field: FormField; reason: string };

export interface FillPlan {
  form: FormSnapshot;
  items: PlanItem[];
}

export const GREEN = 0.9;
const FUZZY_MIN = 0.75;

interface Candidate {
  value: string;
  source: Source;
  confidence: number;
}

function bankAnswer(entry: AnswerEntry, company: string): string {
  return entry.answer.replaceAll("{company}", company);
}

function bankScope(bank: AnswerBank, company: string): AnswerEntry[] {
  const c = normalize(company);
  return bank.answers.filter((e) => !e.company || normalize(e.company) === c);
}

function questionsOf(entry: AnswerEntry, company: string): string[] {
  return [entry.question, ...entry.aliases].map((q) => normalize(q.replaceAll("{company}", company)));
}

function fromBank(label: string, bank: AnswerEntry[], company: string, sensitive: boolean): Candidate | undefined {
  const exact = bank.find((e) => questionsOf(e, company).includes(label));
  if (exact) return { value: bankAnswer(exact, company), source: { type: "bank", id: exact.id, origin: exact.origin }, confidence: 1 };
  if (sensitive) return undefined;

  let best: { entry: AnswerEntry; score: number } | undefined;
  for (const entry of bank) {
    const score = Math.max(...questionsOf(entry, company).map((q) => jaccard(q, label)));
    if (score >= FUZZY_MIN && (!best || score > best.score)) best = { entry, score };
  }
  return best && {
    value: bankAnswer(best.entry, company),
    source: { type: "bank", id: best.entry.id, origin: best.entry.origin },
    confidence: best.score * GREEN,
  };
}

function fromProfile(label: string, field: FormField, profile: Profile, ctx: RuleContext): Candidate | undefined {
  for (const rule of PROFILE_RULES) {
    if (!rule.pattern.test(label)) continue;
    if (rule.kinds && !rule.kinds.includes(field.kind)) continue;
    const value = rule.resolve(profile, label, ctx);
    return value === undefined ? undefined : { value, source: { type: "profile", path: rule.path }, confidence: 1 };
  }
  return undefined;
}

function unanswered(field: FormField, reason: string): PlanItem {
  return field.required ? { status: "blocked", field, reason } : { status: "skip", field, reason };
}

function planField(field: FormField, form: FormSnapshot, profile: Profile, bank: AnswerEntry[]): PlanItem {
  const label = normalize(field.label);
  const sensitive = SENSITIVE.test(label);

  const veto = VETO.find((v) => v.pattern.test(label));
  if (veto) return unanswered(field, veto.reason);

  if (field.kind === "file") {
    if (RESUME.test(label)) {
      return { status: "fill", field, value: profile.documents.resume, source: { type: "file", path: "documents.resume" }, confidence: 1, sensitive: false };
    }
    return unanswered(field, "no document for this upload");
  }

  const candidate = fromBank(label, bank, form.company, sensitive) ?? fromProfile(label, field, profile, { ...(jobCountry(form.jobLocation) ? { jobCountry: jobCountry(form.jobLocation)! } : {}) });
  if (!candidate) return unanswered(field, sensitive ? "sensitive question with no exact answer" : "no answer in profile or answer bank");

  const hasOptions = field.kind === "select" || field.kind === "radio" || (field.kind === "combobox" && field.options.length > 0);
  if (!hasOptions) {
    const confidence = field.kind === "combobox" ? Math.min(candidate.confidence, 0.8) : candidate.confidence;
    return { status: "fill", field, value: candidate.value, source: candidate.source, confidence, sensitive };
  }

  const option = matchOption(field.options, candidate.value, sensitive);
  if (!option) return unanswered(field, `answer "${candidate.value}" matches none of the options`);
  return {
    status: "fill",
    field,
    value: option.option,
    source: candidate.source,
    confidence: Math.min(candidate.confidence, option.confidence),
    sensitive,
  };
}

export function buildPlan(form: FormSnapshot, profile: Profile, bank: AnswerBank): FillPlan {
  const scoped = bankScope(bank, form.company);
  return { form, items: form.fields.map((f) => planField(f, form, profile, scoped)) };
}
