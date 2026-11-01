// The candidate (2026-11-01): no senior, staff, principal or lead roles. A title that also offers an
// early-career level ("[Junior / Senior / Staff]", "Senior / Engineer II") stays; "Member of Technical Staff" is not a level.
const SENIOR = /\b(senior|sr|staff|principal|lead|manager|director|head of|distinguished|architect|vp|iii|iv)\b/i;
const EARLY = /\b(junior|jr|new grad|new college grad|entry|early career|associate|graduate|intern|ii?)\b/i;

export function tooSenior(title: string): boolean {
  const t = title.replace(/\bmember of (the )?technical staff\b/gi, "");
  return SENIOR.test(t) && !EARLY.test(t);
}
