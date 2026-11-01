// The candidate (2026-11-01): no senior, staff, principal or lead roles. A title that also offers an
// early-career level ("[Junior / Senior / Staff]", "Senior / Engineer II") or a non-senior alternative stays (candidate: mixed levels are fine);
// "Member of Technical Staff" is not a level.
const SENIOR = /\b(senior|sr|staff|principal|lead|manager|director|head of|distinguished|architect|vp|iii|iv)\b/i;
const EARLY = /\b(junior|jr|new grad|new college grad|entry|early career|associate|graduate|intern|ii?)\b/i;

// Mixed level: a slash or "or" with a seniority word on one side only ("Senior/Software Engineer",
// "Data Scientist / Senior Data Scientist"); not "Senior / Staff", and not "AI/ML" inside a senior title.
const LEVEL = "senior|sr|staff|principal|lead";
const MIXED = new RegExp(`\\b(${LEVEL})\\.?\\s*(\\/|\\bor\\b)\\s*(?!(${LEVEL})\\b)\\w|\\b(?!(${LEVEL})\\b)\\w+\\s*(\\/|\\bor\\b)\\s*(${LEVEL})\\b`, "i");

export function tooSenior(title: string): boolean {
  const t = title.replace(/\bmember of (the )?technical staff\b/gi, "");
  return SENIOR.test(t) && !EARLY.test(t) && !MIXED.test(t);
}
