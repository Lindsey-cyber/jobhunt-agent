// H-1B sponsorship history (the candidate, 2026-11-02): apply only where the employer filed for
// H-1B workers since 2023, per the Department of Labor's LCA disclosures (as republished by
// h1bdata.info). An employer with no record, or a name that matches no filer, is kept in the
// catalog but not applied to.

export interface H1bFiling {
  employer: string;
  submitted: string; // YYYY-MM-DD
}

export interface H1bRecord {
  company: string;
  // Filer names that matched the company, and their filings since the policy year.
  matched: string[];
  filings: number;
  checkedAt: string;
}

export type SponsorVerdict = "sponsor" | "none" | "unknown";

const SUFFIX = /\b(inc|incorporated|llc|l l c|corp|corporation|co|company|ltd|limited|lp|l p|llp|plc|pbc|holdings?|usa|us|america|north america|global|group)\b/g;

// Well-known employers that file under another name (company as the posting names it → filer name).
export const FILER_ALIASES: Record<string, string> = {
  amd: "ADVANCED MICRO DEVICES",
  ibm: "INTERNATIONAL BUSINESS MACHINES",
  hp: "HP INC",
  hpe: "HEWLETT PACKARD ENTERPRISE",
  "jp morgan chase": "JPMORGAN CHASE",
  bny: "BANK OF NEW YORK MELLON",
  "cvs health": "CVS PHARMACY",
  "dell technologies": "DELL",
  "procter and gamble": "PROCTER",
  "s and p global": "S&P GLOBAL",
  "oscar health": "OSCAR MANAGEMENT",
  "together ai": "TOGETHER COMPUTER",
  newsbreak: "PARTICLE MEDIA",
  "playstation": "SONY INTERACTIVE ENTERTAINMENT",
  "home depot": "HOME DEPOT",
  "cursor anysphere": "ANYSPHERE",
  "schr dinger": "SCHRODINGER",
  "klaviyo campus": "KLAVIYO",
  elevenlabs: "ELEVEN LABS",
  clear: "ALCLEAR",
  "clear corporate": "ALCLEAR",
  "invisible tech": "INVISIBLE TECHNOLOGIES",
  "66 degrees": "66DEGREES",
  "expedia group": "EXPEDIA",
  "peraton labs": "PERATON",
};

export function employerKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^the /, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// "STRIPE INC" matches "Stripe"; "SCALE AI INC" matches "Scale AI"; "FINRA" does not match "Fin".
export function matchesCompany(employer: string, company: string): boolean {
  const e = employerKey(employer), c = employerKey(company);
  if (c.length < 2) return false;
  return e === c || (c.length >= 3 && e.startsWith(`${c} `));
}

export function parseH1bTable(html: string): H1bFiling[] {
  const out: H1bFiling[] = [];
  for (const row of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').trim());
    if (cells.length < 5) continue;
    const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(cells[4]!);
    if (!d) continue;
    out.push({ employer: cells[0]!, submitted: `${d[3]}-${d[1]}-${d[2]}` });
  }
  return out;
}

// The name to search the filings for: an alias when the company files under another name.
export function filerName(company: string): string {
  const k = employerKey(company);
  return FILER_ALIASES[k] ?? FILER_ALIASES[k.replace(/ global$/, "")] ?? k;
}

export function recordFrom(company: string, filings: H1bFiling[], checkedAt: string, since: number): H1bRecord {
  const filer = filerName(company);
  const mine = filings.filter((f) => matchesCompany(f.employer, filer) && Number(f.submitted.slice(0, 4)) >= since);
  return { company, matched: [...new Set(mine.map((f) => f.employer))], filings: mine.length, checkedAt };
}

export function sponsorVerdict(r: H1bRecord | undefined): SponsorVerdict {
  if (!r) return "unknown";
  return r.filings > 0 ? "sponsor" : "none";
}
