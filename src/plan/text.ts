// Label normalization ported from formhand (MIT, github.com/fdjfnd222dd/formhand, core/matcher.js).
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/\bplease (select|choose|enter)( one)?\b/g, " ")
    .replace(/\bselect one\b/g, " ")
    .replace(/\((required|optional)\)/g, " ")
    .replace(/\b(required|optional)\s*$/g, " ")
    .replace(/[^a-z0-9{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(text: string): Set<string> {
  return new Set(normalize(text).split(" ").filter((t) => t.length > 1));
}

export function jaccard(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

export const DECLINE = /\b(decline|declined to state|prefer not|not wish|dont wish|do not wish|choose not|not to disclose|do not disclose|not declared)\b/;
const NOT_VETERAN = /\b(not a (protected )?veteran|am not a veteran|not a protected)\b/;

export interface OptionMatch {
  option: string;
  confidence: number;
}

export function matchOption(options: string[], answer: string, sensitive: boolean): OptionMatch | null {
  const want = normalize(answer);
  const norm = options.map(normalize);

  const exact = norm.indexOf(want);
  if (exact >= 0) return { option: options[exact]!, confidence: 1 };

  if (want === "decline") {
    const i = norm.findIndex((o) => DECLINE.test(o));
    return i >= 0 ? { option: options[i]!, confidence: 1 } : null;
  }

  if (want === "yes" || want === "no") {
    const hits = norm.flatMap((o, i) => (o.split(" ")[0] === want ? [i] : []));
    if (hits.length === 1) return { option: options[hits[0]!]!, confidence: 0.95 };
    if (want === "no" && hits.length === 0) {
      const vet = norm.flatMap((o, i) => (NOT_VETERAN.test(o) ? [i] : []));
      if (vet.length === 1) return { option: options[vet[0]!]!, confidence: 0.95 };
      // Workday: "I identify as a veteran, just not a protected veteran" is a veteran; "I am not a veteran" is the no.
      const plain = vet.filter((i) => /\bam not a veteran\b/.test(norm[i]!) && !/\bidentify as a veteran\b/.test(norm[i]!));
      if (plain.length === 1) return { option: options[plain[0]!]!, confidence: 0.95 };
    }
    return null;
  }

  if (sensitive) return null;
  const hits = norm.flatMap((o, i) => (` ${o} `.includes(` ${want} `) ? [i] : []));
  return hits.length === 1 ? { option: options[hits[0]!]!, confidence: 0.85 } : null;
}
