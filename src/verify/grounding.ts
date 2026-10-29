// Checks a drafted free-text answer against the candidate's own documents
// before it can reach the answer bank. A model cannot certify its own truth:
// every passage it cites must appear in the resume or profile, and every
// number it writes must appear in a source or in the posting.
import { normalize } from "../plan/text.ts";

export interface Draft {
  answer: string;
  evidence: string[];
}

export interface DraftCheck {
  ok: boolean;
  problems: string[];
}

// pdftotext breaks lines and hyphenates ("YOLOv8-\n based"); compare letters and digits only.
const flat = (s: string) => normalize(s).replace(/[^a-z0-9]/g, "");
const NUMBER = /\$?\d+(?:[.,]\d+)*%?/g;

// A sensitive question (authorization, prior employment...) needs a cited passage for any answer, No included.
export function checkDraft(draft: Draft, sources: string[], posting: string, options: string[] = [], sensitive = false): DraftCheck {
  const problems: string[] = [];
  const answer = draft.answer.trim();
  const known = flat(sources.join("\n"));
  if (!answer) problems.push("empty answer");
  if (options.length && !options.includes(answer)) problems.push(`"${answer}" is not one of the options`);

  const yes = /^yes\b/i.test(answer);
  if (options.length && (yes || sensitive) && !draft.evidence.length) problems.push(sensitive ? "an answer to a sensitive question needs a cited passage" : "a Yes needs a cited passage");
  if (!options.length && !draft.evidence.length) problems.push("no cited passages");
  for (const e of draft.evidence) {
    if (flat(e).length < 15) problems.push(`citation too short to check: "${e}"`);
    else if (!known.includes(flat(e))) problems.push(`citation not in the resume or profile: "${e}"`);
  }

  const allowed = new Set([...`${sources.join(" ")} ${posting}`.matchAll(NUMBER)].map((m) => m[0].replace(/[$,]/g, "")));
  for (const m of answer.matchAll(NUMBER)) {
    const n = m[0].replace(/[$,]/g, "");
    if (!allowed.has(n)) problems.push(`number ${m[0]} appears in no source`);
  }
  if (answer.length > 2500) problems.push("answer longer than 2500 characters");
  return { ok: problems.length === 0, problems };
}
