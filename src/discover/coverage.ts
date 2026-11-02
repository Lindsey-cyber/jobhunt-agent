// The search verifier's deciding code (pure): which sampled postings fit her, whether the catalog
// has each one, and why not when it does not. Fetching lives in src/sources/coverage.ts and the
// command in src/cli.ts. The file format is fixed: docs/program/notes.md (W1 reads it).
import type { Job, JobKey } from "../domain/job.ts";
import type { Policy } from "../profile/schema.ts";
import { excludedBy } from "./exclude.ts";
import { atsOf, jobKey } from "./identity.ts";
import { tooSenior } from "./seniority.ts";

export interface SampleRow {
  company: string;
  title: string;
  location: string;
  date: string;
  list: string;
  // The apply link the list gave: an ATS URL gives a JobKey, anything else is matched by name.
  url?: string | undefined;
}

export interface Miss {
  company: string;
  title: string;
  url: string;
  cause: string;
}

export interface CoverageReport {
  date: string;
  sources: string[];
  n: number;
  inCatalog: number;
  inCatalogNotRejected: number;
  misses: Miss[];
}

export type Matched = { job: Job; how: "key" | "title" | "fuzzy" };

// ---- independence -------------------------------------------------------------------------------

// owner/repo for a GitHub page or raw URL, else the URL without query or fragment.
export function sourceIdentity(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const [owner, repo] = u.pathname.split("/").filter(Boolean);
    if ((host === "github.com" || host === "raw.githubusercontent.com") && owner && repo) return `github:${owner}/${repo}`.toLowerCase();
    return `${host}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

// Source URLs the pipeline already fetches, which would make the sample circular.
export function notIndependent(sourceUrls: readonly string[], watchlistUrls: readonly string[]): string[] {
  const watched = new Set(watchlistUrls.map(sourceIdentity));
  return sourceUrls.filter((u) => watched.has(sourceIdentity(u)));
}

export const urlsIn = (text: string): string[] => text.match(/https?:\/\/[^\s'"<>)\]},]+/g) ?? [];

// ---- names ----------------------------------------------------------------------------------------

export const normCompany = (s: string): string =>
  s.toLowerCase().replace(/&/g, " and ").replace(/\b(inc|llc|ltd|corp|corporation|co|company|the)\b\.?/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
export const normTitle = (s: string): string =>
  normCompany(s.replace(/\(.*?\)|\[.*?\]/g, " ").replace(/\b(new (college )?grad(uate)?|early career|university grad(uate)?|campus|2026|2027|full[- ]time)\b/gi, " "));
const tokens = (s: string) => new Set(normTitle(s).split(" ").filter((t) => t.length > 1));
export function similarity(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  let both = 0;
  for (const t of x) if (y.has(t)) both++;
  return both / (x.size + y.size - both || 1);
}
export const FUZZY = 0.75;

// ---- list parsing ---------------------------------------------------------------------------------

const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const cellText = (cell: string) => cell.replace(/<[^>]+>/g, " ").replace(/\]\([^)]*\)/g, "").replace(/[[\]]/g, "").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
const cellLink = (cell: string) => /\]\((https?:[^)\s]+)\)/.exec(cell)?.[1] ?? /href="([^"]+)"/.exec(cell)?.[1];

// "Nov 01" carries no year: the most recent such day that is not in the future.
export function parseListDate(s: string, now: Date): Date | undefined {
  const m = /([A-Za-z]{3})[a-z]*\.? (\d{1,2})/.exec(s);
  if (!m) return undefined;
  const mo = MON.indexOf(m[1]!.toLowerCase());
  if (mo < 0) return undefined;
  const y = now.getUTCFullYear();
  const d = new Date(Date.UTC(y, mo, Number(m[2])));
  return d.getTime() > now.getTime() + 864e5 ? new Date(Date.UTC(y - 1, mo, Number(m[2]))) : d;
}

// Markdown tables of company | title | location | link-or-model | date (the jobright and cvrve layouts).
export function parseListTable(list: string, md: string): SampleRow[] {
  const out: SampleRow[] = [];
  let prev = "";
  for (const line of md.split("\n")) {
    if (!line.startsWith("|")) continue;
    const c = line.split("|").slice(1, -1);
    if (c.length < 4 || /^\s*:?-+/.test(c[0]!) || /^\s*\**company/i.test(c[0]!)) continue;
    let company = cellText(c[0]!);
    if (company.startsWith("↳")) company = prev;
    else prev = company;
    out.push({ company, title: cellText(c[1]!), location: cellText(c[2]!), date: cellText(c[c.length - 1]!), list, url: cellLink(c[3]!) ?? cellLink(c[1]!) });
  }
  return out;
}

// ---- who is a fitting posting ---------------------------------------------------------------------

const FIT = /machine learning|\bml\b|\bai\b|artificial intelligence|data scien|data engineer|applied scien|research (engineer|scien)|computer vision|\bnlp\b|deep learning|\bllm|generative|\bgenai\b|perception|\bmlops\b/i;
const NOT_ENTRY = /\b(intern|internship|co-?op|phd|ph\.d)\b/i;
const US = /\b(United States|USA|US|Remote|[A-Z][a-z]+(?: [A-Z][a-z]+)*, (?:A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY]))\b/;
const ABROAD = /united kingdom|canada|india|germany|australia|new zealand/i;

// US, early-career, ML/AI/data title, listed within `maxAgeDays`, and not out under her policy.
export function fits(r: SampleRow, policy: Pick<Policy, "excludeCompanies" | "excludeTitles" | "excludeSeniorTitles">, now: Date, maxAgeDays = 30): boolean {
  const d = parseListDate(r.date, now);
  if (!d || now.getTime() - d.getTime() > maxAgeDays * 864e5) return false;
  if (!FIT.test(r.title) || NOT_ENTRY.test(r.title) || !US.test(r.location) || ABROAD.test(r.location)) return false;
  if (policy.excludeSeniorTitles && tooSenior(r.title)) return false;
  if (excludedBy(r.company, policy.excludeCompanies)) return false;
  return !policy.excludeTitles.some((t) => r.title.toLowerCase().includes(t.toLowerCase()));
}

// Unique by company+title, then at most `max` evenly spaced over the sorted rows (deterministic).
export function sampleOf(rows: readonly SampleRow[], max: number): SampleRow[] {
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    const k = `${normCompany(r.company)}|${normTitle(r.title)}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
  unique.sort((a, b) => (a.company + a.title).localeCompare(b.company + b.title));
  return unique.length > max ? Array.from({ length: max }, (_, k) => unique[Math.floor((k * unique.length) / max)]!) : unique;
}

// ---- matching -------------------------------------------------------------------------------------

export interface CatalogIndex {
  byKey: ReadonlyMap<JobKey, Job>;
  byCompany: ReadonlyMap<string, readonly Job[]>;
}

export function indexCatalog(jobs: Iterable<Job>): CatalogIndex {
  const byKey = new Map<JobKey, Job>();
  const byCompany = new Map<string, Job[]>();
  for (const j of jobs) {
    byKey.set(j.key, j);
    const k = normCompany(j.company);
    byCompany.set(k, [...(byCompany.get(k) ?? []), j]);
  }
  return { byKey, byCompany };
}

// A catalog row stands for a list entry unless it is itself a senior title or an overseas copy.
const candidate = (j: Job) => !tooSenior(j.title) && j.triage.rule !== "location.non_us";

// An ATS URL names the posting exactly (JobKey); otherwise the same company and the same
// title, or a near title (Jaccard >= 0.75). Company plus title only decides coverage here: it never merges the catalog.
export function match(r: SampleRow, idx: CatalogIndex): Matched | undefined {
  if (r.url) {
    const k = jobKey(r.url);
    // An ATS URL that names a posting decides alone: if that posting is not in the catalog, it is a miss,
    // even when the catalog holds another posting with the same company and title.
    if (atsOf(k)) {
      const byKey = idx.byKey.get(k);
      return byKey ? { job: byKey, how: "key" } : undefined;
    }
  }
  const cand = (idx.byCompany.get(normCompany(r.company)) ?? []).filter(candidate);
  const exact = cand.find((j) => normTitle(j.title) === normTitle(r.title));
  if (exact) return { job: exact, how: "title" };
  const best = cand.map((j) => ({ j, s: similarity(r.title, j.title) })).sort((a, b) => b.s - a.s)[0];
  return best && best.s >= FUZZY ? { job: best.j, how: "fuzzy" } : undefined;
}

// ---- causes ---------------------------------------------------------------------------------------

export interface WatchedBoard {
  ats: string;
  // Titles the official board lists right now; undefined when that cannot be checked cheaply.
  titles?: readonly string[] | undefined;
}

// Why a sampled posting is not usable in the catalog. Undefined means it is (in the catalog, not rejected).
export function causeOf(r: SampleRow, found: Matched | undefined, idx: CatalogIndex, boards: readonly WatchedBoard[]): string | undefined {
  if (found) return found.job.triage.verdict === "reject" ? `filtered by triage rule ${found.job.triage.rule}` : undefined;
  // A company the catalog holds official rows for is watched, even when found through a list link.
  const official = new Set((idx.byCompany.get(normCompany(r.company)) ?? []).filter((j) => j.official).map((j) => j.key.split(":")[0]!));
  const known = [...boards, ...[...official].filter((a) => !boards.some((b) => b.ats === a)).map((ats) => ({ ats }) as WatchedBoard)];
  if (known.length === 0) return "company not on watchlist";
  const checked = known.filter((b) => b.titles);
  if (checked.length === known.length && checked.every((b) => !b.titles!.some((t) => normTitle(t) === normTitle(r.title) || similarity(t, r.title) >= FUZZY))) {
    return `stale list entry (not on the official ${known.map((b) => b.ats).join("/")} board)`;
  }
  return `watched company, posting not fetched (${known.map((b) => b.ats).join("/")})`;
}

export interface Judged {
  row: SampleRow;
  found: Matched | undefined;
  cause: string | undefined;
}

export function report(date: string, sources: string[], judged: readonly Judged[]): CoverageReport {
  const hits = judged.filter((j) => j.found);
  return {
    date,
    sources,
    n: judged.length,
    inCatalog: hits.length,
    inCatalogNotRejected: hits.filter((j) => j.found!.job.triage.verdict !== "reject").length,
    misses: judged.filter((j) => j.cause).map((j) => ({ company: j.row.company, title: j.row.title, url: j.found?.job.url ?? j.row.url ?? "", cause: j.cause! })),
  };
}

export function summarize(r: CoverageReport): string {
  const pct = (a: number) => (r.n ? `${((100 * a) / r.n).toFixed(1)}%` : "n/a");
  const causes = new Map<string, number>();
  for (const m of r.misses) {
    const c = m.cause.replace(/ \(.*\)$/, "").replace(/^filtered by triage rule .*/, "filtered by triage rule");
    causes.set(c, (causes.get(c) ?? 0) + 1);
  }
  const top = [...causes].sort((a, b) => b[1] - a[1]).map(([c, k]) => `${c} ${k}`).join("; ");
  return `Coverage ${r.date}: ${r.inCatalog}/${r.n} sampled postings are in the catalog (${pct(r.inCatalog)}), ${r.inCatalogNotRejected}/${r.n} in it and not rejected (${pct(r.inCatalogNotRejected)}), from ${r.sources.length} independent source${r.sources.length === 1 ? "" : "s"}. ${r.misses.length ? `Misses by cause: ${top}.` : "No misses."}`;
}
