// Answering from facts. Every fact about the candidate gets an id:
// each profile field ("profile:workAuthorization.needsSponsorship") and each answer she gave
// ("answer:visa-status"). A question the rules cannot answer is mapped once, by a model, to one
// fact and an answer taken from it (data/question-map.jsonl); a mapping that cites no existing
// fact is dropped. Mapped answers carry origin "fact" and the fact id as evidence.
import type { AnswerBank, AnswerEntry, Profile } from "../profile/schema.ts";

export interface Fact {
  id: string;
  about: string;
  value: string;
}

function flatten(prefix: string, v: unknown, out: Fact[]): void {
  if (v === undefined || v === null || v === "") return;
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== "object")) out.push({ id: `profile:${prefix}`, about: prefix, value: v.join(", ") });
    else v.forEach((x, i) => flatten(`${prefix}[${i}]`, x, out));
    return;
  }
  if (typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) flatten(prefix ? `${prefix}.${k}` : k, x, out);
    return;
  }
  out.push({ id: `profile:${prefix}`, about: prefix, value: String(v) });
}

export function factSheet(profile: Profile, bank: AnswerBank): Fact[] {
  const out: Fact[] = [];
  const { documents: _documents, ...rest } = profile;
  flatten("", rest, out);
  for (const a of bank.answers) if (a.origin === "human" && !a.company && !a.jobTitle) out.push({ id: `answer:${a.id}`, about: a.question, value: a.answer });
  return out;
}

export interface QuestionMapping {
  question: string; // the form's label, as asked
  options?: string[] | undefined; // the choices offered, when it is a choice field
  fact: string; // a Fact id, or "none"
  answer: string; // the option to pick, or the text to type
  reason: string;
  by: string;
  at: string;
}

// A mapping becomes an answer only when it cites an existing fact, and for a choice
// field only when the answer is one of the offered options.
export function acceptMapping(m: QuestionMapping, facts: Map<string, Fact>): AnswerEntry | undefined {
  const fact = facts.get(m.fact);
  if (!fact || !m.answer.trim()) return undefined;
  if (m.options?.length && !m.options.includes(m.answer)) return undefined;
  return { id: `fact:${m.fact}:${m.question.slice(0, 40)}`, question: m.question, aliases: [], answer: m.answer, origin: "fact", evidence: [`${fact.id} = ${fact.value}`] };
}
