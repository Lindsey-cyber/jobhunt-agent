// Pay ranges printed in a posting, as annual US dollars. Pure.
// "$60,000 - $100,000", "$60K–$100K", "$28.50 - $45.00 per hour" (x 2080).

export interface PayRange {
  min: number;
  max: number;
}

const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)`;
const RANGE = new RegExp(String.raw`\$\s?${NUM}\s?([kK])?\s*(?:-|–|—|to)\s*\$?\s?${NUM}\s?([kK])?(\s*(?:\/|per|an|a)\s*(?:hour|hr)\b)?`, "g");

function amount(n: string, k: string | undefined): number {
  const v = Number(n.replace(/,/g, ""));
  return k ? v * 1000 : v;
}

export function payRanges(text: string): PayRange[] {
  const out: PayRange[] = [];
  for (const m of text.matchAll(RANGE)) {
    // "$60-100K": the K on the second number applies to both.
    const k1 = m[2] ?? (m[4] && Number(m[1]!.replace(/,/g, "")) < 1000 ? m[4] : undefined);
    let min = amount(m[1]!, k1);
    let max = amount(m[3]!, m[4]);
    if (m[5] || max < 1000) {
      // Hourly, or a bare small number that only makes sense per hour.
      if (!m[5] || max > 500) continue;
      min *= 2080;
      max *= 2080;
    }
    if (max < min || max < 10_000) continue;
    out.push({ min, max });
  }
  return out;
}

// "$100K–$150K" -> 100000: the low end of the candidate's expectation.
export function expectationFloor(expectation: string | undefined): number | undefined {
  return expectation ? payRanges(expectation)[0]?.min : undefined;
}

// The candidate (2026-10-30): skip postings whose pay tops out at or below her range's low end
// ("$60K-$100K" when she expects $100K-$150K). A posting that prints no pay is not skipped.
export function payBelowExpectation(description: string, floor: number | undefined): boolean {
  if (!floor) return false;
  const ranges = payRanges(description);
  if (!ranges.length) return false;
  return Math.max(...ranges.map((r) => r.max)) <= floor;
}
