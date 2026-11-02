// The search verifier's deciding code (pure): which sampled postings fit her, whether the catalog
// has each one, and why not when it does not. Fetching lives in src/sources/coverage.ts and the
// command in src/cli.ts. The file format is fixed: docs/program/notes.md (W1 reads it).
import type { Job, JobKey } from "../domain/job.ts";
import type { Policy } from "../profile/schema.ts";
import { policyExcludes } from "./eligibility.ts";
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
  // The list itself marks the posting closed (🔒 in the link column): history, not an opening.
  closed?: boolean | undefined;
  // The requisition id (lowercase, as in a Workday JobKey) the employer's own site gives this posting, when the link
  // names it only by another site's id (an Eightfold position id on a career site that fronts Workday).
  requisition?: string | undefined;
}

export interface Miss {
  company: string;
  title: string;
  url: string;
  cause: string;
  band?: Band;
}

// How large an employer is, from its H-1B filings since the policy year: large >= 200, mid 20-199, small < 20,
// unknown when nobody looked it up. Only large and mid employers count toward gate 1a.
export type Band = "large" | "mid" | "small" | "unknown";
export const BANDS: readonly Band[] = ["large", "mid", "small", "unknown"];
export const LARGE_MIN = 200;
export const MID_MIN = 20;
export const bandOf = (filings: number | undefined): Band =>
  filings === undefined || !Number.isFinite(filings) || filings < 0 ? "unknown" : filings >= LARGE_MIN ? "large" : filings >= MID_MIN ? "mid" : "small";
export const isBig = (b: Band | undefined): boolean => b === "large" || b === "mid";
export interface BandCount { n: number; inCatalog: number; inCatalogNotRejected: number }
export type BandCounts = Record<Band, BandCount>;

export interface CoverageReport {
  date: string;
  sources: string[];
  n: number;
  inCatalog: number;
  inCatalogNotRejected: number;
  misses: Miss[];
  // List entries that no longer exist on the employer's official board: not postings, so not in n.
  staleExcluded?: number;
  stale?: Stale[];
  // The same counts split by the employer's size band (they add up to n). Gate 1a reads large + mid only.
  bands?: BandCounts;
}

export interface Stale {
  company: string;
  title: string;
  url: string;
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

// Plain text normalization (titles): lowercase, "&" as "and", legal words and punctuation dropped.
const normText = (s: string): string =>
  s.toLowerCase().replace(/([a-z])(\d)/g, "$1 $2").replace(/&/g, " and ").replace(/\b(inc|llc|ltd|corp|corporation|co|company|the)\b\.?/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

// Legal-form words only, dropped from the END of a name: "Acme, LLC" is "Acme". Every other word is meaningful:
// "General Motors" is not "General", "Bank of America" is not "Bank of".
const LEGAL_SUFFIX = new Set(["inc", "llc", "ltd", "corp", "corporation", "co", "plc", "gmbh", "lp", "llp"]);

// Company names: accents, dots and parentheticals dropped, "&" as "and", lowercase, a trailing legal suffix dropped.
export function normCompany(s: string): string {
  const base = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\([^)]*\)/g, " ").replace(/\./g, "");
  const words = base.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIX.has(words.at(-1)!)) words.pop();
  return words.join(" ");
}

// One name per employer for identity checks (config/watchlist.yaml `aliases:`, alias -> name it stands for): "GDIT" and
// "General Dynamics Information Technology" are one company, and Venmo is PayPal. Both sides are normalized, so
// spelling and legal suffixes do not matter. One hop only: an alias that points at another alias is a mistake
// (a chain or a loop would make two names compare unequal), and it throws. This is identity, never eligibility:
// policy exclusions still compare the names as written.
export type Canon = (name: string) => string;
export function makeCanon(aliases: Readonly<Record<string, string>> = {}): Canon {
  const table = new Map<string, string>();
  for (const [from, to] of Object.entries(aliases)) {
    const a = normCompany(from);
    const b = normCompany(to);
    if (a === "" || b === "") throw new Error(`alias "${from}: ${to}": a name that normalizes to nothing`);
    if (a !== b) table.set(a, b);
  }
  for (const [a, b] of table) if (table.has(b)) throw new Error(`alias chain: "${a}" -> "${b}" -> "${table.get(b)}": point every alias straight at the name it stands for`);
  return (name) => {
    const n = normCompany(name);
    return table.get(n) ?? n;
  };
}

// Band of a company's size: the watchlist's band (derived from the same H-1B counts) when it has one, else the filings
// count itself, else unknown. `watch` is keyed by canonical name.
export interface SizeSources {
  watch: ReadonlyMap<string, Band>;
  filings: (company: string) => number | undefined;
}
const RANK: Record<Band, number> = { large: 3, mid: 2, small: 1, unknown: 0 };
// A company on the watchlist more than once (several boards): its largest band.
export function watchBands(entries: readonly { company: string; band?: Band | undefined }[], canon: Canon = normCompany): Map<string, Band> {
  const out = new Map<string, Band>();
  for (const e of entries) {
    const b = e.band ?? "unknown";
    const k = canon(e.company);
    if (RANK[b] > RANK[out.get(k) ?? "unknown"]) out.set(k, b);
  }
  return out;
}
export function bandOfCompany(company: string, canon: Canon, src: SizeSources): Band {
  const c = canon(company);
  const w = src.watch.get(c);
  if (w && w !== "unknown") return w;
  return bandOf(src.filings(company) ?? src.filings(c));
}

export const normTitle = (s: string): string =>
  normText(s.replace(/\(.*?\)|\[.*?\]/g, " ").replace(/\b(new (college )?grad(uate)?|early career|university grad(uate)?|campus|2026|2027|full[- ]time)\b/gi, " "));
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
    out.push({ company, title: cellText(c[1]!), location: cellText(c[2]!), date: cellText(c[c.length - 1]!), list, url: cellLink(c[3]!) ?? cellLink(c[1]!), ...(c[3]!.includes("🔒") ? { closed: true } : {}) });
  }
  return out;
}

// ---- who is a fitting posting ---------------------------------------------------------------------

const FIT = /machine learning|\bml\b|\bai\b|artificial intelligence|data scien|data engineer|applied scien|research (engineer|scien)|computer vision|\bnlp\b|deep learning|\bllm|generative|\bgenai\b|perception|\bmlops\b/i;
const NOT_ENTRY = /\b(intern|internship|co-?op|phd|ph\.d)\b/i;
const US = /\b(United States|USA|US|Remote|[A-Z][a-z]+(?: [A-Z][a-z]+)*, (?:A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY]))\b/;
const ABROAD = /united kingdom|canada|india|germany|australia|new zealand/i;

// US, early-career, ML/AI/data title, listed within `maxAgeDays`, and not out under her policy.
export function fits(r: SampleRow, policy: Parameters<typeof policyExcludes>[2] & Pick<Policy, "excludeSeniorTitles">, now: Date, maxAgeDays = 30): boolean {
  const d = parseListDate(r.date, now);
  if (r.closed) return false;
  if (!d || now.getTime() - d.getTime() > maxAgeDays * 864e5) return false;
  if (!FIT.test(r.title) || NOT_ENTRY.test(r.title) || !US.test(r.location) || ABROAD.test(r.location)) return false;
  if (policy.excludeSeniorTitles && tooSenior(r.title)) return false;
  return policyExcludes(r.company, r.title, policy).length === 0;
}

// True when the row's company is a listed aggregator (a site that reposts other employers' jobs): its rows are
// not an employer's postings, so the sample leaves them out.
export function isAggregator(company: string, aggregators: readonly string[], canon: Canon = normCompany): boolean {
  const c = canon(company);
  return c !== "" && aggregators.some((a) => canon(a) === c);
}

// Unique by company+title, then at most `max` evenly spaced over the sorted rows (deterministic).
export function sampleOf(rows: readonly SampleRow[], max: number, canon: Canon = normCompany): SampleRow[] {
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    const k = `${canon(r.company)}|${normTitle(r.title)}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
  unique.sort((a, b) => (a.company + a.title).localeCompare(b.company + b.title));
  return unique.length > max ? Array.from({ length: max }, (_, k) => unique[Math.floor((k * unique.length) / max)]!) : unique;
}

// ---- matching -------------------------------------------------------------------------------------

export interface CatalogIndex {
  byKey: ReadonlyMap<JobKey, Job>;
  // Keyed by canonical company name (see makeCanon).
  byCompany: ReadonlyMap<string, readonly Job[]>;
  canon: Canon;
}

// The requisition a Workday JobKey carries ("workday:acme:jr100" -> "jr100"); undefined for every other key.
export const requisitionOf = (key: string): string | undefined => (key.startsWith("workday:") ? key.split(":").slice(2).join(":") || undefined : undefined);

export function indexCatalog(jobs: Iterable<Job>, canon: Canon = normCompany): CatalogIndex {
  const byKey = new Map<JobKey, Job>();
  const byCompany = new Map<string, Job[]>();
  for (const j of jobs) {
    byKey.set(j.key, j);
    const k = canon(j.company);
    const list = byCompany.get(k);
    if (list) list.push(j);
    else byCompany.set(k, [j]);
  }
  return { byKey, byCompany, canon };
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
      if (byKey) return { job: byKey, how: "key" };
      if (!r.requisition) return undefined;
    }
  }
  const cand = (idx.byCompany.get(idx.canon(r.company)) ?? []).filter(candidate);
  // The employer's own site names the posting by its requisition: that id is the same posting under the Workday key.
  // When the link's own id found nothing, the requisition decides alone: no title guess.
  if (r.requisition) {
    const same = cand.filter((j) => requisitionOf(j.key) === r.requisition);
    const hit = same.find((j) => j.triage.verdict !== "reject") ?? same[0];
    if (hit) return { job: hit, how: "key" };
    if (r.url && atsOf(jobKey(r.url))) return undefined;
  }
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
  // JobKeys the board lists (Greenhouse/Lever/Ashby job id, Workday requisition).
  keys?: readonly string[] | undefined;
  // The listing is known to be incomplete (e.g. a capped Workday walk): it can prove a posting live, never gone.
  partial?: boolean | undefined;
  // Workday only: "tenant/site" of the career site this board is (see workdaySite). A link on another site is not this board's.
  site?: string | undefined;
  // Greenhouse/Lever/Ashby: the board slug (see boardOf). A link naming another slug is not this board's.
  board?: string | undefined;
}

// A board read in full: its titles and its ids are both known, and nothing was cut short.
export const readInFull = (b: WatchedBoard): boolean => b.titles !== undefined && b.keys !== undefined && !b.partial;

// The board slug an ATS apply link names, lowercase: greenhouse/<slug>/jobs/<id>, jobs.lever.co/<slug>/<id>,
// jobs.ashbyhq.com/<slug>/<id>, or a Greenhouse embed with ?for=<slug>. Undefined when the link names none.
export function boardOf(url: string): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean).map((p) => p.toLowerCase());
  if (host.endsWith("greenhouse.io")) return u.searchParams.get("for")?.toLowerCase() || (parts[1] === "jobs" ? parts[0] : undefined);
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co" || host === "jobs.ashbyhq.com") return parts[0];
  return undefined;
}

// "tenant/site" of a Workday job link or career-site URL (a locale segment such as en-US is skipped); undefined otherwise.
export function workdaySite(url: string): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  const host = u.hostname.toLowerCase();
  if (!host.endsWith(".myworkdayjobs.com")) return undefined;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts[0] && /^[a-z]{2}-[a-z]{2}$/i.test(parts[0])) parts.shift();
  return parts[0] ? `${host.split(".")[0]}/${parts[0].toLowerCase()}` : undefined;
}

const hostIsAts = (url: string, domain: string): boolean => {
  try {
    return new URL(url).hostname.toLowerCase().endsWith(domain);
  } catch {
    return false;
  }
};

export type Liveness = "live" | "not_listed" | "unknown";

// Is a sampled posting still on its employer's official board(s)? Live: a board lists its job id (when the list's
// link names one), or lists its title. When the link names the id and every board of that ATS for the company (the
// same Workday site, for Workday) was read in full without it, the id is gone: only the identical title (a repost
// under a new id) keeps the entry live, a merely near title never does (Nextdoor's "Machine Learning Engineer, Machine
// Learning" is not "Machine Learning Engineer - Ads"). Without such a complete read, or without an id in the link, a
// title (exact, or near) proves live and nothing proves gone. Everything else is unknown.
export function liveness(r: SampleRow, known: readonly WatchedBoard[]): Liveness {
  if (known.length === 0) return "unknown";
  const named = r.url ? jobKey(r.url) : undefined;
  const key = named && atsOf(named) ? named : undefined;
  if (key !== undefined && known.some((b) => b.keys?.includes(key))) return "live";
  const req = r.requisition;
  if (req !== undefined && known.some((b) => b.keys?.some((k) => requisitionOf(k) === req))) return "live";
  const exact = known.some((b) => b.titles?.some((t) => normTitle(t) === normTitle(r.title)));
  const near = exact || known.some((b) => b.titles?.some((t) => similarity(t, r.title) >= FUZZY));
  if (key === undefined) return near ? "live" : "unknown";
  const ats = atsOf(key)!;
  // The employer's site names the posting by another site's id (a Workday requisition given by its Eightfold page), or the link
  // embeds an ATS id (gh_jid) on the employer's own domain while the employer's boards are on other ATSs (Revionics moved from
  // Greenhouse to Workday and the old page still carries gh_jid): the id says nothing about those boards, so the posting is
  // judged on its requisition (if known) and its title against every board, all of which must have been read in full to call it gone.
  const embedded = ats === "greenhouse" && !hostIsAts(r.url!, "greenhouse.io");
  const elsewhere = req !== undefined || (embedded && !known.some((b) => b.ats === ats));
  if (elsewhere) return known.every(readInFull) ? (exact ? "live" : "not_listed") : near ? "live" : "unknown";
  // The exact board the link names: a Workday site, or a Greenhouse/Lever/Ashby slug. Another board of the same company
  // says nothing about this posting. A link that names no board is judged against every board of its ATS.
  const site = ats === "workday" ? workdaySite(r.url!) : undefined;
  const slug = ats === "workday" ? undefined : boardOf(r.url!);
  const same = known.filter((b) => b.ats === ats && (ats !== "workday" || b.site === site) && (slug === undefined || b.board?.toLowerCase() === slug));
  if (same.length > 0 && same.every(readInFull)) return exact ? "live" : "not_listed";
  return near ? "live" : "unknown";
}

export const STALE_CAUSE = "stale list entry";
export const isStale = (cause: string | undefined): boolean => cause?.startsWith(STALE_CAUSE) ?? false;

// How many postings a measurement needs before it counts (src/discover/gates.ts GATE_LIMITS.coverageN).
export const MIN_N = 50;
// What `jh coverage` aims for: this many large + mid real postings (the gate itself needs MIN_N).
export const RESAMPLE_TARGET = 100;

// More rows from the lists when stale exclusions leave fewer than `min` real postings: the rows not yet
// taken, de-duplicated like sampleOf, evenly spaced and deterministic. Fewer than asked when the lists run out.
export function resampleRows(pool: readonly SampleRow[], taken: readonly SampleRow[], n: number, min = MIN_N, canon: Canon = normCompany): SampleRow[] {
  if (n >= min) return [];
  const have = new Set(taken.map((r) => `${canon(r.company)}|${normTitle(r.title)}`));
  return sampleOf(pool.filter((r) => !have.has(`${canon(r.company)}|${normTitle(r.title)}`)), min - n, canon);
}

// Why a sampled posting is not usable in the catalog. Undefined means it is (in the catalog, not rejected).
export function causeOf(r: SampleRow, found: Matched | undefined, idx: CatalogIndex, boards: readonly WatchedBoard[]): string | undefined {
  if (found) return found.job.triage.verdict === "reject" ? `filtered by triage rule ${found.job.triage.rule}` : undefined;
  // A company the catalog holds official rows for is watched, even when found through a list link.
  const official = new Set((idx.byCompany.get(idx.canon(r.company)) ?? []).filter((j) => j.official).map((j) => j.key.split(":")[0]!));
  const known = [...boards, ...[...official].filter((a) => !boards.some((b) => b.ats === a)).map((ats) => ({ ats }) as WatchedBoard)];
  if (known.length === 0) return "company not on watchlist";
  if (liveness(r, known) === "not_listed") return `${STALE_CAUSE} (not on the official ${known.map((b) => b.ats).join("/")} board)`;
  return `watched company, posting not fetched (${known.map((b) => b.ats).join("/")})`;
}

export interface Judged {
  row: SampleRow;
  found: Matched | undefined;
  cause: string | undefined;
  band?: Band | undefined;
}

export const emptyBands = (): BandCounts => ({ large: { n: 0, inCatalog: 0, inCatalogNotRejected: 0 }, mid: { n: 0, inCatalog: 0, inCatalogNotRejected: 0 }, small: { n: 0, inCatalog: 0, inCatalogNotRejected: 0 }, unknown: { n: 0, inCatalog: 0, inCatalogNotRejected: 0 } });

export function report(date: string, sources: string[], judged: readonly Judged[]): CoverageReport {
  const stale = judged.filter((j) => isStale(j.cause));
  const real = judged.filter((j) => !isStale(j.cause));
  const hits = real.filter((j) => j.found);
  const bands = emptyBands();
  for (const j of real) {
    const b = bands[j.band ?? "unknown"];
    b.n++;
    if (j.found) b.inCatalog++;
    if (j.found && j.found.job.triage.verdict !== "reject") b.inCatalogNotRejected++;
  }
  return {
    date,
    sources,
    n: real.length,
    inCatalog: hits.length,
    inCatalogNotRejected: hits.filter((j) => j.found!.job.triage.verdict !== "reject").length,
    misses: real.filter((j) => j.cause).map((j) => ({ company: j.row.company, title: j.row.title, url: j.found?.job.url ?? j.row.url ?? "", cause: j.cause!, band: j.band ?? "unknown" })),
    bands,
    staleExcluded: stale.length,
    stale: stale.map((j) => ({ company: j.row.company, title: j.row.title, url: j.row.url ?? "" })),
  };
}

// Large + mid rows of a measurement: the ones gate 1a counts.
export function bigCounts(b: BandCounts): BandCount {
  return { n: b.large.n + b.mid.n, inCatalog: b.large.inCatalog + b.mid.inCatalog, inCatalogNotRejected: b.large.inCatalogNotRejected + b.mid.inCatalogNotRejected };
}
const bigShare = (b: BandCounts): string => {
  const c = bigCounts(b);
  return `${c.inCatalog}/${c.n}${c.n ? ` = ${((100 * c.inCatalog) / c.n).toFixed(1)}%` : ""}`;
};

export function summarize(r: CoverageReport): string {
  const pct = (a: number) => (r.n ? `${((100 * a) / r.n).toFixed(1)}%` : "n/a");
  const causes = new Map<string, number>();
  for (const m of r.misses) {
    const c = m.cause.replace(/ \(.*\)$/, "").replace(/^filtered by triage rule .*/, "filtered by triage rule");
    causes.set(c, (causes.get(c) ?? 0) + 1);
  }
  const top = [...causes].sort((a, b) => b[1] - a[1]).map(([c, k]) => `${c} ${k}`).join("; ");
  const bandLine = r.bands ? ` By employer size (real postings, in catalog / sampled): ${BANDS.map((b) => `${b} ${r.bands![b].inCatalog}/${r.bands![b].n}`).join(", ")}; counted for gate 1a (large + mid): ${bigShare(r.bands)}.` : "";
  return `Coverage ${r.date}: ${r.inCatalog}/${r.n} sampled postings are in the catalog (${pct(r.inCatalog)}), ${r.inCatalogNotRejected}/${r.n} in it and not rejected (${pct(r.inCatalogNotRejected)}), from ${r.sources.length} independent source${r.sources.length === 1 ? "" : "s"}${r.staleExcluded ? `; ${r.staleExcluded} stale list entries (gone from the official board) excluded from n` : ""}.${bandLine} ${r.misses.length ? `Misses by cause: ${top}.` : "No misses."}`;
}
