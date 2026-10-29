import type { FormField, FormSnapshot } from "../domain/form.ts";
import type { AnswerBank, AnswerEntry, Profile } from "../profile/schema.ts";
import { AGREEING_OPTION, ATTESTATION_ALLOWED, ATTESTATION_OPTION, COMPENSATION_VETO, TERMS_NOTICE, jobCountry, SALARY_EXPECTATION, SALARY_HISTORY, PRIVACY_EXCEPT, PRIVACY_NOTICE, PROFILE_RULES, RESUME, SENSITIVE, VETO, type RuleContext } from "./rules.ts";
import { DECLINE, jaccard, matchOption, normalize } from "./text.ts";

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
const TRUNCATED = 100;

interface Candidate {
  value: string;
  source: Source;
  confidence: number;
}

function bankAnswer(entry: AnswerEntry, company: string): string {
  return entry.answer.replaceAll("{company}", company);
}

function bankScope(bank: AnswerBank, company: string, jobTitle: string): AnswerEntry[] {
  const c = normalize(company);
  const t = normalize(jobTitle);
  return bank.answers.filter((e) => (!e.company || normalize(e.company) === c) && (!e.jobTitle || normalize(e.jobTitle) === t));
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

// "Cleveland Guardians - Baseball Operations" -> "cleveland-guardians-baseball-operations".
export const companySlug = (company: string) => normalize(company).replace(/ /g, "-");

// The leading whole sentences of `text` that fit in `max` characters, or undefined when not even one does.
export function fitSentences(text: string, max: number): string | undefined {
  const sentences = text.match(/[^.!?]+[.!?]+(\s+|$)/g) ?? [text];
  let out = "";
  for (const s of sentences) {
    if ((out + s).trimEnd().length > max) break;
    out += s;
  }
  return out.trim() || undefined;
}

function unanswered(field: FormField, reason: string): PlanItem {
  return field.required ? { status: "blocked", field, reason } : { status: "skip", field, reason };
}

function planField(field: FormField, form: FormSnapshot, profile: Profile, bank: AnswerEntry[]): PlanItem {
  const label = normalize(field.label);
  const sensitive = SENSITIVE.test(label);

  // The one signature the candidate allowed: the voluntary disability self-identification form.
  const allowedSignature = profile.signSelfIdentificationForms && /^self identification form signature (name|date)$/.test(label);
  // Certifications, arbitration, interview rules and recording she agreed to (2026-10-29):
  // a choice field whose agreeing option is unambiguous. Typed signatures and free text stay hers.
  if (profile.acceptApplicationAttestations && field.kind !== "text" && field.kind !== "textarea" && field.kind !== "file" && ATTESTATION_ALLOWED.test(label)) {
    const agree = field.options.length === 1 ? field.options : field.options.filter((o) => AGREEING_OPTION.test(o.trim()));
    if (agree.length === 1) return { status: "fill", field, value: agree[0]!, source: { type: "profile", path: "acceptApplicationAttestations" }, confidence: 1, sensitive: false };
  }
  const veto = allowedSignature ? undefined : VETO.find((v) => v.pattern.test(label));
  const expectation = veto === COMPENSATION_VETO && profile.salaryExpectation && (field.kind === "text" || field.kind === "textarea") && SALARY_EXPECTATION.test(label) && !SALARY_HISTORY.test(label);
  if (expectation) return { status: "fill", field, value: profile.salaryExpectation!, source: { type: "profile", path: "salaryExpectation" }, confidence: 1, sensitive: false };
  // A compensation range list that offers not disclosing: decline it (her range spans several buckets).
  const declineComp = veto === COMPENSATION_VETO && field.options.length > 1 ? field.options.filter((o) => DECLINE.test(normalize(o))) : [];
  if (declineComp.length === 1) return { status: "fill", field, value: declineComp[0]!, source: { type: "profile", path: "salaryExpectation" }, confidence: 1, sensitive: false };
  if (veto) return unanswered(field, veto.reason);
  // A checkbox whose only choices are "I acknowledge" / "I agree" is an attestation,
  // unless the candidate answered this exact question in the answer bank.
  // Lyft asks the same as a one-option dropdown.
  const attestation = (field.kind === "checkbox" || (field.options.length === 1 && field.kind !== "radio")) && field.options.length > 0 && field.options.every((o) => ATTESTATION_OPTION.test(normalize(o)));
  if (attestation && !bank.some((e) => questionsOf(e, form.company).includes(label))) {
    const text = normalize([field.label, ...field.options].join(" "));
    if (profile.acknowledgePrivacyPolicies && field.options.length === 1 && PRIVACY_NOTICE.test(text) && !PRIVACY_EXCEPT.test(text)) {
      return { status: "fill", field, value: field.options[0]!, source: { type: "profile", path: "acknowledgePrivacyPolicies" }, confidence: 1, sensitive: false };
    }
    if (profile.acceptApplicationTerms && field.options.length === 1 && TERMS_NOTICE.test(text) && !/\b(certify|accurate|signature|arbitration|non compete)\b/.test(text)) {
      return { status: "fill", field, value: field.options[0]!, source: { type: "profile", path: "acceptApplicationTerms" }, confidence: 1, sensitive: false };
    }
    return unanswered(field, "acknowledgements and consents need the candidate");
  }

  // Greenhouse's EEO block: declining race resets "Are you Hispanic/Latino?" to
  // decline and hides the race question. A voluntary race question left blank declines it.
  if (form.ats === "greenhouse" && field.id === "race" && profile.eeo.race === "decline" && !field.required) {
    return { status: "skip", field, reason: "race declined by leaving it blank (choosing decline resets the Hispanic/Latino answer)" };
  }
  // Declining race on a Greenhouse board declines the whole question pair: the board resets
  // Hispanic/Latino to decline (and the race question may appear only after "No", required,
  // as on Accenture Federal Services). Answer the pair as declined from the start.
  if (form.ats === "greenhouse" && field.id === "hispanic_ethnicity" && profile.eeo.race === "decline") {
    const decline = field.options.find((o) => DECLINE.test(normalize(o)));
    if (decline) return { status: "fill", field, value: decline, source: { type: "profile", path: "eeo.race" }, confidence: 1, sensitive: true };
  }

  if (field.kind === "file") {
    if (RESUME.test(label)) {
      return { status: "fill", field, value: profile.documents.resume, source: { type: "file", path: "documents.resume" }, confidence: 1, sensitive: false };
    }
    // A cover letter written for this employer, only where the form requires one.
    const letter = /\bcover letter\b/.test(label) && field.required ? profile.documents.coverLetters[companySlug(form.company)] : undefined;
    if (letter) return { status: "fill", field, value: letter, source: { type: "file", path: "documents.coverLetters" }, confidence: 1, sensitive: false };
    return unanswered(field, "no document for this upload");
  }

  const ctx = { options: field.options, company: form.company, fieldId: field.id, ...(form.jobLocation ? { jobLocation: form.jobLocation } : {}), ...(form.priorApplications !== undefined ? { priorApplications: form.priorApplications } : {}), ...(jobCountry(form.jobLocation) ? { jobCountry: jobCountry(form.jobLocation)! } : {}) };
  const banked = fromBank(label, bank, form.company, sensitive);
  // A bank answer in free-text words ("2 weeks") that none of the choices spell gives way to a profile rule that maps it ("1 Month").
  const bankFits = !banked || field.options.length === 0 || field.kind === "text" || field.kind === "textarea" || Boolean(matchOption(field.options, banked.value, sensitive));
  const candidate = (bankFits ? banked : undefined) ?? fromProfile(label, field, profile, ctx) ?? banked;
  if (!candidate) return unanswered(field, sensitive ? "sensitive question with no exact answer" : "no answer in profile or answer bank");

  // A checkbox list (Workday's race/ethnicity) is matched like a radio group.
  const hasOptions = field.kind === "select" || field.kind === "radio" || (field.kind === "combobox" && field.options.length > 0) || (field.kind === "checkbox" && field.options.length > 1);
  if (!hasOptions) {
    // "decline" (and the EEO yes/no tokens) are choices, not text: typed into a search box
    // whose options never loaded they select whatever comes first (Crowe's race list).
    // (Workday's menus are clicked, not typed: its adapter picks the menu's own decline option.)
    const workdayDecline = form.ats === "workday" && candidate.value === "decline";
    if (!workdayDecline && field.kind !== "text" && field.kind !== "textarea" && candidate.source.type === "profile" && candidate.source.path.startsWith("eeo.")) {
      return unanswered(field, "the field's choices did not load");
    }
    const confidence = field.kind === "combobox" ? Math.min(candidate.confidence, 0.8) : candidate.confidence;
    // A box with a character limit keeps the whole sentences that fit; a value that cannot be cut so is held.
    if (field.maxLength && candidate.value.length > field.maxLength) {
      const fit = fitSentences(candidate.value, field.maxLength);
      if (!fit) return unanswered(field, `the answer is longer than the box allows (${field.maxLength} characters)`);
      return { status: "fill", field, value: fit, source: candidate.source, confidence, sensitive };
    }
    return { status: "fill", field, value: candidate.value, source: candidate.source, confidence, sensitive };
  }

  const option = matchOption(field.options, candidate.value, sensitive);
  // A list cut off at its first page (100 schools from A) is searched by typing;
  // the readback proves what got selected.
  if (!option && field.kind === "combobox" && field.options.length >= TRUNCATED && !sensitive) {
    return { status: "fill", field, value: candidate.value, source: candidate.source, confidence: Math.min(candidate.confidence, 0.8), sensitive };
  }
  // Workday: "United States" is listed as "United States of America".
  const extended = !option && !sensitive ? field.options.filter((o) => normalize(o).startsWith(`${normalize(candidate.value)} `)) : [];
  // Several ("… of America", "… Minor Outlying Islands"): the shortest is the place itself.
  const shortest = [...extended].sort((a, b) => a.length - b.length)[0];
  if (shortest) return { status: "fill", field, value: shortest, source: candidate.source, confidence: Math.min(candidate.confidence, 0.9), sensitive };
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
  const scoped = bankScope(bank, form.company, form.jobTitle);
  return { form, items: form.fields.map((f) => planField(f, form, profile, scoped)) };
}
