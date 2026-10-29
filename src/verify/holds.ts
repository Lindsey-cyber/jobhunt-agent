// Why applications are held, grouped so each kind goes to the right place:
// a missing answer to the candidate's list, a site mechanic (a control that did
// not operate, a page that would not save) to an engineering session, and
// deliberate holds (captchas, signatures, compensation) stay hers by design.
export type HoldCause = "answer" | "mechanic" | "by_design";

export function holdCause(reason: string): HoldCause {
  if (/captcha|compensation is never|legal attestations|references are someone else|emergency contacts|submit it yourself|press submit yourself/i.test(reason)) return "by_design";
  if (/no answer in profile|sensitive question with no exact answer|acknowledgements and consents|no document for this upload|matches none of the options|is empty after filling/i.test(reason)) return "answer";
  return "mechanic";
}

export interface HoldTally {
  cause: HoldCause;
  reason: string;
  count: number;
  examples: string[];
}

// Reasons are grouped by their text with quoted values and numbers removed, so
// "no option fits "New York"" and "no option fits "Austin"" count as one mechanic.
export function tallyHolds(entries: { key: string; reasons: string[] }[]): HoldTally[] {
  const groups = new Map<string, HoldTally>();
  for (const e of entries) {
    for (const r of new Set(e.reasons)) {
      const shape = r
        .replace(/^fill error: .*?: (?=[a-z"]|locator|no |the )/i, "fill error: ")
        .replace(/"[^"]*"/g, '"…"')
        .replace(/\d+/g, "N")
        .slice(0, 160);
      const t = groups.get(shape) ?? { cause: holdCause(r), reason: shape, count: 0, examples: [] };
      t.count++;
      if (t.examples.length < 3) t.examples.push(e.key);
      groups.set(shape, t);
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}
