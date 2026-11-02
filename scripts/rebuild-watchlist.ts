// Rebuilds config/watchlist.yaml from data: H-1B filing counts (size proxy), catalog history, policy.
// Usage: npx tsx scripts/rebuild-watchlist.ts [--offline] [--refresh-h1b] [--dry]
//   --offline      no network: use cached H-1B counts, discover no new boards
//   --refresh-h1b  look every company up again (default: only companies with no cached record)
//   --dry          print the report, write nothing
// Read-only toward employers (public board APIs and h1bdata.info); never opens an application form.
// Its H-1B counts go to data/h1b/watchlist-counts.json, never to the shared data/h1b/sponsors.json (that cache belongs to jh h1b and
// eligibility). sponsors.json is read only as a fallback when a company has no count of its own. Only greenhouse, lever, ashby, workday and pending are rewritten; every other section is kept verbatim.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse } from "yaml";
import { employerKey, filerName, parseH1bTable, recordFrom, type H1bFiling } from "../src/discover/h1b.ts";
import { excludedBy } from "../src/discover/exclude.ts";
import { ROLE } from "../src/discover/triage.ts";
import { getJson, getText, pool } from "../src/sources/http.ts";
import { readCatalog } from "../src/store/catalog.ts";
import { readH1b } from "../src/store/h1b.ts";
import { Policy } from "../src/profile/schema.ts";

// ---------- pure helpers (tested in tests/watchlist.test.ts) ----------

export type Band = "large" | "mid" | "small" | "unknown";
export type Kind = "greenhouse" | "lever" | "ashby" | "workday";
export const LARGE_MIN = 200;
export const MID_MIN = 20;
export const RECENT_DAYS = 180;

// filings === undefined: never looked up (or the lookup failed).
export const bandOf = (filings: number | undefined): Band => (filings === undefined ? "unknown" : filings >= LARGE_MIN ? "large" : filings >= MID_MIN ? "mid" : "small");
export const isBig = (b: Band): boolean => b === "large" || b === "mid";
// src/sources/fetch.ts accepts only these two sizes; the band and count ride along as extra fields.
export const sizeOf = (b: Band): "medium_large" | "unknown" => (isBig(b) ? "medium_large" : "unknown");

// Same scope as triage: ROLE plus data scientist / statistician titles (DATA_SCIENCE in src/discover/triage.ts, not exported).
const DATA_SCIENCE = /data scien|biostatistic|statistician|statistical (?:data )?analyst|statistical scientist/i;
export const isMlTitle = (title: string): boolean => ROLE.test(title) || DATA_SCIENCE.test(title);

export interface Evidence {
  band: Band;
  excluded: boolean;
  everMatch: boolean;
  recentMatch: boolean;
  mlTitle: boolean;
}
export type Decision = { keep: true; why: "recent-match" | "big-and-ml" | "no-drop-rule" } | { keep: false; why: "excluded" | "no-match-no-ml-small" };

export function decide(e: Evidence): Decision {
  if (e.excluded) return { keep: false, why: "excluded" };
  if (e.recentMatch) return { keep: true, why: "recent-match" };
  if (isBig(e.band) && e.mlTitle) return { keep: true, why: "big-and-ml" };
  // A failed or missing lookup is not evidence of a small employer: keep.
  if (!e.everMatch && !e.mlTitle && e.band !== "unknown" && !isBig(e.band)) return { keep: false, why: "no-match-no-ml-small" };
  return { keep: true, why: "no-drop-rule" };
}

export interface Located { kind: Kind | "other"; board?: string; site?: string; ats?: string; careers?: string }

// Where a job URL says the employer's board lives.
export function locate(url: string): Located | undefined {
  let u: URL;
  try { u = new URL(url); } catch { return undefined; }
  const host = u.hostname.toLowerCase();
  const seg = u.pathname.split("/").filter(Boolean);
  if (/^(job-)?boards(-api)?\.greenhouse\.io$/.test(host)) {
    const s = host.includes("api") ? seg[2] : seg[0];
    return s && s !== "embed" ? { kind: "greenhouse", board: s } : undefined;
  }
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") return seg[0] ? { kind: "lever", board: seg[0] } : undefined;
  if (host === "jobs.ashbyhq.com") return seg[0] ? { kind: "ashby", board: seg[0] } : undefined;
  if (host.endsWith(".myworkdayjobs.com")) {
    const i = /^[a-z]{2}-[A-Z]{2}$/.test(seg[0] ?? "") ? 1 : 0;
    return seg[i] ? { kind: "workday", site: `https://${host}/${seg[i]}` } : undefined;
  }
  const other: [RegExp, string][] = [
    [/icims\.com$/, "iCIMS"], [/taleo\.net$/, "Taleo"], [/smartrecruiters\.com$/, "SmartRecruiters"], [/successfactors\.(com|eu)$/, "SuccessFactors"],
    [/oraclecloud\.com$/, "Oracle Cloud"], [/eightfold\.ai$/, "Eightfold"], [/phenompeople\.com$/, "Phenom"], [/jobvite\.com$/, "Jobvite"],
    [/workable\.com$/, "Workable"], [/bamboohr\.com$/, "BambooHR"], [/paylocity\.com$/, "Paylocity"], [/ultipro\.com$/, "UKG"], [/adp\.com$/, "ADP"], [/brassring\.com$/, "BrassRing"],
  ];
  const hit = other.find(([re]) => re.test(host));
  return hit ? { kind: "other", ats: hit[1], careers: `${u.protocol}//${host}${/^\/?$/.test(u.pathname) ? "" : `/${seg[0] ?? ""}`}` } : undefined;
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const plain = (s: string) => (/^[A-Za-z0-9_.-]+$/.test(s) && !/^(\d+|true|false|null|yes|no|on|off|~)$/i.test(s) ? s : q(s));

export interface Entry { kind: Kind; board?: string; site?: string; company: string; ai?: boolean; filings?: number | undefined; band: Band }

export function renderEntry(e: Entry): string {
  const id = e.kind === "workday" ? `site: ${q(e.site ?? "")}` : `board: ${plain(e.board ?? "")}`;
  const parts = [id, `company: ${q(e.company)}`, `size: ${sizeOf(e.band)}`, `band: ${e.band}`];
  if (e.filings !== undefined) parts.push(`h1b: ${e.filings}`);
  if (e.ai) parts.push("ai: true");
  return `  - { ${parts.join(", ")} }`;
}

export interface Pending { company: string; ats: string; careers: string; filings?: number | undefined; band: Band; note?: string }
export const renderPending = (p: Pending): string =>
  `  - { company: ${q(p.company)}, ats: ${q(p.ats)}, careers: ${q(p.careers)}, band: ${p.band}${p.filings !== undefined ? `, h1b: ${p.filings}` : ""}${p.note ? `, note: ${q(p.note)}` : ""} }`;

// Rough board-slug guesses from a company name ("Stripe, Inc." -> stripe, stripeinc).
export function slugGuesses(company: string): string[] {
  const k = employerKey(company).replace(/[^a-z0-9 ]/g, "");
  const words = k.split(" ").filter(Boolean);
  return [...new Set([words.join(""), words.join("-"), words[0] ?? ""].filter((s) => s.length >= 3))];
}

// Top-level sections of the watchlist file. A comment or blank line goes with the section below it, unless an indented
// line follows it, in which case it stays in the section above: joining every section back gives the text exactly.
export interface Section { key: string | null; lines: string[] }
const TOP_KEY = /^([A-Za-z_]\w*):/;
export function splitSections(text: string): Section[] {
  const blocks: Section[] = [{ key: null, lines: [] }];
  let held: string[] = [];
  for (const line of text.split("\n")) {
    const m = TOP_KEY.exec(line);
    if (m) {
      blocks.push({ key: m[1]!, lines: [...held, line] });
      held = [];
    } else if (line.trim() === "" || line.startsWith("#")) held.push(line);
    else {
      blocks.at(-1)!.lines.push(...held, line);
      held = [];
    }
  }
  blocks.at(-1)!.lines.push(...held);
  return blocks;
}

// Rewrites the sections named in `regenerated` (the body lines under each key) and copies every other section verbatim, in
// its place. A regenerated section with no lines is dropped; a regenerated section the file lacks is appended at the end.
export function assembleWatchlist(text: string, regenerated: Record<string, string[]>): string {
  const blocks = splitSections(text);
  const present = new Set(blocks.map((b) => b.key));
  const out: string[] = [];
  for (const b of blocks) {
    if (b.key === null || !(b.key in regenerated)) {
      out.push(...b.lines);
      continue;
    }
    const body = regenerated[b.key]!;
    if (body.length === 0) continue;
    const at = b.lines.findIndex((l) => TOP_KEY.test(l));
    out.push(...b.lines.slice(0, at), b.lines[at]!, ...body);
  }
  const extra = Object.entries(regenerated).filter(([k, body]) => !present.has(k) && body.length > 0).flatMap(([k, body]) => [`${k}:`, ...body]);
  if (extra.length) {
    if (out.at(-1) === "") out.pop();
    out.push(...extra, "");
  }
  return out.join("\n");
}

// ---------- data ----------

const NOW = new Date(process.env.WATCHLIST_NOW ?? Date.now());
const WATCHLIST = "config/watchlist.yaml";
const COUNTS = "data/h1b/watchlist-counts.json";

// One count per employer key. filings === null with failed: true is a lookup that failed: unknown, never zero.
export interface Count { filings: number | null; since: number; checkedAt: string; failed?: true }
export function readCounts(file = COUNTS): Map<string, Count> {
  if (!existsSync(file)) return new Map();
  return new Map(Object.entries(JSON.parse(readFileSync(file, "utf8")) as Record<string, Count>));
}
export function writeCounts(counts: Map<string, Count>, file = COUNTS): void {
  writeFileSync(file, `${JSON.stringify(Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b))), null, 1)}\n`);
}
const arg = (k: string) => process.argv.includes(k);

// The 17 companies docs/research/search-coverage.md found missing (cause A), in the form their board is looked up.
export const COVERAGE_MISSES = [
  "Tata Consultancy Services", "Omnicom", "L.E.K. Consulting", "Stamp", "Sixtyfour", "Centene", "Concord", "American Express", "Capgemini",
  "BNY", "American Honda", "Eaton", "General Dynamics IT", "Annapurna Labs", "Gauntlet", "B4Corp", "Military Spouse Jobs",
];
// Boards known from memory; every one is verified live before it is written. Annapurna Labs is Amazon's team: Amazon hires through amazon.jobs (no public ATS).
const KNOWN: Record<string, Located> = {
  "american express": { kind: "workday", site: "https://aexp.wd5.myworkdayjobs.com/Amex" },
  capgemini: { kind: "workday", site: "https://capgemini.wd3.myworkdayjobs.com/capgemini" },
  eaton: { kind: "other", ats: "Eightfold", careers: "https://eaton.eightfold.ai/careers" },
  centene: { kind: "workday", site: "https://centene.wd5.myworkdayjobs.com/Centene_External" },
  "american honda": { kind: "other", ats: "Workday (Honda)", careers: "https://careers.honda.com" },
  bny: { kind: "other", ats: "Eightfold", careers: "https://bny.eightfold.ai/careers" },
  "tata consultancy services": { kind: "other", ats: "TCS iBegin (own site)", careers: "https://www.tcs.com/careers" },
  omnicom: { kind: "other", ats: "Omnicom Careers (own site)", careers: "https://www.omnicomgroup.com/careers/" },
  "general dynamics it": { kind: "other", ats: "Oracle Cloud", careers: "https://www.gdit.com/careers/" },
  "annapurna labs": { kind: "other", ats: "amazon.jobs (own site)", careers: "https://www.amazon.jobs/en/teams/annapurna-labs" },
  gauntlet: { kind: "lever", board: "gauntlet" },
  netflix: { kind: "other", ats: "Eightfold", careers: "https://explore.jobs.netflix.net" },
  microsoft: { kind: "other", ats: "Microsoft Careers (own site)", careers: "https://jobs.careers.microsoft.com" },
  meta: { kind: "other", ats: "Meta Careers (own site)", careers: "https://www.metacareers.com/jobs" },
  amazon: { kind: "other", ats: "amazon.jobs (own site)", careers: "https://www.amazon.jobs" },
  "amazon web services": { kind: "other", ats: "amazon.jobs (own site)", careers: "https://www.amazon.jobs" },
  apple: { kind: "other", ats: "Apple Jobs (own site)", careers: "https://jobs.apple.com" },
  tesla: { kind: "other", ats: "Tesla Careers (own site)", careers: "https://www.tesla.com/careers" },
  intuit: { kind: "other", ats: "Intuit Careers (own site)", careers: "https://jobs.intuit.com" },
  ibm: { kind: "other", ats: "IBM Careers (own site)", careers: "https://www.ibm.com/careers" },
  atlassian: { kind: "other", ats: "Atlassian Careers (own site)", careers: "https://www.atlassian.com/company/careers" },
  deloitte: { kind: "other", ats: "Deloitte Careers (own site)", careers: "https://apply.deloitte.com" },
  qualcomm: { kind: "workday", site: "https://qualcomm.wd12.myworkdayjobs.com/External" },
  amd: { kind: "workday", site: "https://amd.wd1.myworkdayjobs.com/AMD" },
  honeywell: { kind: "workday", site: "https://honeywell.wd5.myworkdayjobs.com/Honeywell" },
  nike: { kind: "workday", site: "https://nike.wd1.myworkdayjobs.com/nke" },
  "micron technology": { kind: "workday", site: "https://micron.wd1.myworkdayjobs.com/External" },
  "wells fargo": { kind: "workday", site: "https://wf.wd1.myworkdayjobs.com/WellsFargoJobs" },
  comcast: { kind: "workday", site: "https://comcast.wd5.myworkdayjobs.com/Comcast_Careers" },
  "military spouse jobs": { kind: "other", ats: "unknown (job aggregator, not an employer)", careers: "https://www.google.com/search?q=Military+Spouse+Jobs+careers" },
};

interface Row { kind: Kind; board?: string; site?: string; company: string; ai: boolean }

function readWatchlist(text: string): { rows: Row[]; pending: Pending[] } {
  const w = parse(text) as Record<string, unknown>;
  const rows: Row[] = [];
  for (const kind of ["greenhouse", "lever", "ashby"] as const)
    for (const b of (w[kind] as { board: string; company: string; ai?: boolean }[] | undefined) ?? []) rows.push({ kind, board: String(b.board), company: b.company, ai: b.ai === true });
  for (const b of (w.workday as { site: string; company: string }[] | undefined) ?? []) rows.push({ kind: "workday", site: b.site, company: b.company, ai: false });
  const pending = ((w.pending as { company: string; ats: string; careers: string; note?: string }[] | undefined) ?? []).map((p) => ({ ...p, band: "unknown" as Band }));
  return { rows, pending };
}

// ---------- H-1B (all years since 2023 summed; the site answers one year per request) ----------

async function lookupAllYears(company: string, checkedAt: string, since: number): Promise<{ filings: number } | undefined> {
  const q2 = encodeURIComponent(filerName(company) || company.trim()).replace(/%20/g, "+");
  const filings: H1bFiling[] = [];
  try {
    for (let y = Number(checkedAt.slice(0, 4)); y >= since; y--) {
      const html = await getText(`https://h1bdata.info/index.php?em=${q2}&job=&city=&year=${y}`, 60000);
      if (!/<th>EMPLOYER<\/th>/i.test(html) && !/no results|0 results/i.test(html)) return undefined; // throttled page, not "no filings"
      filings.push(...parseH1bTable(html));
    }
  } catch {
    return undefined;
  }
  return { filings: recordFrom(company, filings, checkedAt, since).filings };
}

async function ensureH1b(companies: string[], counts: Map<string, Count>, refresh: boolean, since: number): Promise<number> {
  // Tried again: no count yet, a failed count, or everything with --refresh-h1b.
  const todo = [...new Map(companies.map((c) => [employerKey(c), c])).entries()]
    .filter(([k]) => refresh || counts.get(k)?.filings === undefined || counts.get(k)?.filings === null)
    .map(([, c]) => c);
  let done = 0, failed = 0;
  const checkedAt = NOW.toISOString();
  await pool(todo, 6, async (c) => {
    const k = employerKey(c);
    const r = await lookupAllYears(c, checkedAt, since);
    if (r) counts.set(k, { filings: r.filings, since, checkedAt });
    else {
      failed++;
      // A failed refresh keeps an earlier good count; a company with none is recorded as failed.
      if (counts.get(k)?.filings === undefined || counts.get(k)?.filings === null) counts.set(k, { filings: null, since, checkedAt, failed: true });
    }
    if (++done % 100 === 0) {
      writeCounts(counts);
      console.error(`h1b lookups ${done}/${todo.length} (${failed} failed)`);
    }
  });
  writeCounts(counts);
  console.error(`h1b lookups done: ${todo.length} tried, ${failed} failed`);
  return failed;
}

// ---------- board discovery (public board APIs, read-only) ----------

async function liveBoard(kind: "greenhouse" | "lever" | "ashby", board: string, company: string, strict: boolean): Promise<boolean> {
  try {
    if (kind === "greenhouse") {
      const m = await getJson<{ name?: string }>(`https://boards-api.greenhouse.io/v1/boards/${board}`, 20000);
      if (!m.name) return false;
      return !strict || matchName(m.name, company);
    }
    if (strict) return false; // lever/ashby APIs do not name the company, so a guessed slug cannot be verified
    if (kind === "lever") return Array.isArray(await getJson(`https://api.lever.co/v0/postings/${board}?mode=json&limit=1`, 20000));
    const a = await getJson<{ jobs?: unknown[] }>(`https://api.ashbyhq.com/posting-api/job-board/${board}`, 20000);
    return Array.isArray(a.jobs);
  } catch {
    return false;
  }
}
const matchName = (a: string, b: string) => {
  const x = employerKey(a), y = employerKey(b);
  return x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `);
};

async function liveWorkday(site: string): Promise<boolean> {
  try {
    const u = new URL(site);
    const tenant = u.hostname.split(".")[0]!;
    const r = await fetch(`https://${u.hostname}/wday/cxs/${tenant}${u.pathname}/jobs`, { method: "POST", headers: { "content-type": "application/json", "user-agent": "jobhunt-agent/2 (personal job search; read-only)" }, body: JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: "" }), signal: AbortSignal.timeout(20000) });
    return r.ok && ((await r.json()) as { total?: number }).total !== undefined;
  } catch {
    return false;
  }
}

// ---------- main ----------

async function main(): Promise<void> {
  const offline = arg("--offline"), dry = arg("--dry");
  const text = readFileSync(WATCHLIST, "utf8");
  // Loaded as src/profile/load.ts does: the same Policy schema, parsed from data/policy.yaml.
  const policy = Policy.parse(parse(readFileSync("data/policy.yaml", "utf8")) ?? {});
  const exclude = policy.excludeCompanies;
  const since = policy.h1bRequiredSince;
  if (since === null) throw new Error("data/policy.yaml has no h1bRequiredSince: there is no H-1B year to look up");
  const { rows, pending: allPending } = readWatchlist(text);

  // Catalog history per employer key and per board.
  const cutoff = new Date(NOW.getTime() - RECENT_DAYS * 86400000).toISOString();
  interface Hist { everMatch: boolean; recentMatch: boolean; mlTitle: boolean; ml: Set<string>; urls: Set<string> }
  const byKey = new Map<string, Hist>(), byBoard = new Map<string, Hist>();
  const display = new Map<string, string>();
  const hist = (m: Map<string, Hist>, k: string) => m.get(k) ?? (m.set(k, { everMatch: false, recentMatch: false, mlTitle: false, ml: new Set(), urls: new Set() }), m.get(k)!);
  for (const j of readCatalog("data/discovery/catalog.jsonl").values()) {
    const key = employerKey(j.company);
    if (!display.has(key)) display.set(key, j.company);
    const hs = [hist(byKey, key)];
    for (const s of j.sources) {
      const l = s.official ? locate(s.source) : undefined;
      if (l && (l.board || l.site)) hs.push(hist(byBoard, `${l.kind}:${(l.board ?? l.site)!.toLowerCase()}`));
    }
    const ml = isMlTitle(j.title);
    for (const h of hs) {
      if (j.triage.verdict === "match") {
        h.everMatch = true;
        if (j.lastSeen >= cutoff || (j.publishedAt && j.publishedAt >= cutoff)) h.recentMatch = true;
      }
      if (ml) { h.mlTitle = true; h.ml.add(j.title); }
      if (h.urls.size < 3) h.urls.add(j.url);
    }
  }

  // Own counts first; sponsors.json (read-only) only for a company this file has no number for.
  const counts = readCounts();
  const sponsors = readH1b("data");
  const onList = rows.map((r) => r.company);
  const candidates: string[] = [...COVERAGE_MISSES];
  // Companies in the catalog that hire for AI/ML but are not watched (big ones are added below).
  const watched = new Set(onList.map(employerKey));
  // Pending entries with no ATS named are looked at again each run.
  const oldPending = allPending.filter((p) => p.ats !== "unknown" && !/^Workday \(site not confirmed/.test(p.ats));
  const pendingKeys = new Set(oldPending.map((p) => employerKey(p.company)));
  const extra = [...byKey].filter(([k, h]) => h.mlTitle && !watched.has(k) && !pendingKeys.has(k) && !excludedBy(display.get(k)!, exclude)).map(([k]) => display.get(k)!);
  candidates.push(...extra);

  if (!offline) await ensureH1b([...onList, ...candidates], counts, arg("--refresh-h1b"), since);
  const filingsOf = (c: string): number | undefined => {
    const k = employerKey(c);
    return counts.get(k)?.filings ?? sponsors.get(k)?.filings;
  };

  // Keep / drop the existing boards.
  const kept: (Row & { filings: number | undefined; band: Band; why: string })[] = [];
  const dropped: { row: Row; why: string; band: Band; filings: number | undefined }[] = [];
  for (const r of rows) {
    const filings = filingsOf(r.company);
    const band = bandOf(filings);
    const id = `${r.kind}:${(r.board ?? r.site)!.toLowerCase()}`;
    const hs = [byBoard.get(id), byKey.get(employerKey(r.company))].filter((h): h is Hist => Boolean(h));
    const d = decide({
      band,
      excluded: Boolean(excludedBy(r.company, exclude)),
      everMatch: hs.some((h) => h.everMatch),
      recentMatch: hs.some((h) => h.recentMatch),
      mlTitle: hs.some((h) => h.mlTitle),
    });
    if (d.keep) kept.push({ ...r, filings, band, why: d.why }); else dropped.push({ row: r, why: d.why, band, filings });
  }

  // Additions: coverage misses always; others only when large/mid.
  const added: (Row & { filings: number | undefined; band: Band; src: string })[] = [];
  const pending: Pending[] = oldPending.map((p) => ({ ...p, filings: filingsOf(p.company), band: bandOf(filingsOf(p.company)) }));
  const missing: string[] = [];
  const have = new Set(kept.map((r) => `${r.kind}:${(r.board ?? r.site)!.toLowerCase()}`));
  const seen = new Set<string>();
  if (!offline) {
    for (const company of candidates) {
      const k = employerKey(company);
      if (seen.has(k) || watched.has(k) || pendingKeys.has(k)) continue;
      seen.add(k);
      const isMiss = COVERAGE_MISSES.includes(company);
      const filings = filingsOf(company), band = bandOf(filings);
      if (!isMiss && !isBig(band)) continue;
      // Where is its official board? Catalog URLs first, then known boards, then Greenhouse by name.
      const h = byKey.get(k);
      let loc: Located | undefined;
      for (const u of h?.urls ?? []) { const l = locate(u); if (l && l.kind !== "other") { loc = l; break; } }
      loc ??= KNOWN[k];
      let placed = false;
      const finish = async (l: Located, strict: boolean): Promise<boolean> => {
        if (l.kind === "workday" && l.site) {
          if (!(await liveWorkday(l.site))) return false;
          const id = `workday:${l.site.toLowerCase()}`;
          if (have.has(id)) return true;
          have.add(id);
          added.push({ kind: "workday", site: l.site, company, ai: false, filings, band, src: isMiss ? "coverage miss" : "catalog" });
          return true;
        }
        if (l.kind === "greenhouse" || l.kind === "lever" || l.kind === "ashby") {
          if (!(await liveBoard(l.kind, l.board!, company, strict))) return false;
          const id = `${l.kind}:${l.board!.toLowerCase()}`;
          if (have.has(id)) return true;
          have.add(id);
          added.push({ kind: l.kind, board: l.board!, company, ai: false, filings, band, src: isMiss ? "coverage miss" : "catalog" });
          return true;
        }
        return false;
      };
      if (loc && loc.kind !== "other") placed = await finish(loc, false);
      if (!placed) for (const s of slugGuesses(company)) if (await finish({ kind: "greenhouse", board: s }, true)) { placed = true; break; }
      if (!placed) {
        const unverified: Located | undefined = loc?.kind === "workday" ? { kind: "other", ats: "Workday (site not confirmed live)", careers: loc.site! } : undefined;
        const careers = loc?.kind === "other" ? loc : unverified ?? [...(h?.urls ?? [])].map(locate).find((l) => l?.kind === "other");
        pending.push({ company, ats: careers?.ats ?? "unknown", careers: careers?.careers ?? `https://www.google.com/search?q=${encodeURIComponent(`${company} careers`)}`, filings, band });
        if (!careers) missing.push(company);
      }
    }
  }

  // Write the file: greenhouse, lever, ashby and workday regenerated; every other section (pending included) kept verbatim.
  // Pending: every row keeps the line as written, except one this run placed on a board; a new row is rendered.
  const all = [...kept.map((r) => ({ ...r })), ...added];
  const section = (k: Kind) => all.filter((r) => r.kind === k).map((r) => renderEntry({ ...r, kind: k }));
  const written: [string, string][] = [];
  for (const l of splitSections(text).find((b) => b.key === "pending")?.lines ?? []) {
    if (/^\s*- /.test(l)) written.push([employerKey((parse(l.trim()) as [{ company: string }])[0]!.company), l]);
  }
  const writtenKeys = new Set(written.map(([k]) => k));
  const placedKeys = new Set(added.map((r) => employerKey(r.company)));
  const pendingLines = [
    ...written.filter(([k]) => !placedKeys.has(k)).map(([, l]) => l),
    ...pending.filter((p) => !writtenKeys.has(employerKey(p.company)) && !placedKeys.has(employerKey(p.company))).map(renderPending),
  ];
  const out = assembleWatchlist(text, {
    greenhouse: section("greenhouse"),
    lever: section("lever"),
    ashby: section("ashby"),
    workday: section("workday"),
    pending: pendingLines,
  });
  if (!dry) {
    writeFileSync(WATCHLIST, out);
    writeCounts(counts);
  }

  // Report.
  const per = (k: Kind) => ({ kept: kept.filter((r) => r.kind === k).length, dropped: dropped.filter((d) => d.row.kind === k).length, added: added.filter((r) => r.kind === k).length });
  console.log("per ATS (kept / dropped / added):");
  for (const k of ["greenhouse", "lever", "ashby", "workday"] as const) { const c = per(k); console.log(`  ${k}: ${c.kept} / ${c.dropped} / ${c.added}`); }
  console.log(`  total: ${kept.length} / ${dropped.length} / ${added.length}; pending: ${pending.length}`);
  const bands: Record<Band, number> = { large: 0, mid: 0, small: 0, unknown: 0 };
  for (const r of all) bands[r.band]++;
  console.log("size bands on the new list:", JSON.stringify(bands));
  const why: Record<string, number> = {};
  for (const r of kept) why[r.why] = (why[r.why] ?? 0) + 1;
  console.log("kept because:", JSON.stringify(why));
  console.log("added:");
  for (const r of added) console.log(`  + ${r.kind} ${r.board ?? r.site} ${r.company} [${r.band} ${r.filings ?? "?"}] (${r.src})`);
  console.log("pending:");
  for (const p of pending) console.log(`  ? ${p.company} [${p.band} ${p.filings ?? "?"}] ${p.ats} ${p.careers}`);
  if (missing.length) console.log("no board or careers URL found:", missing.join(", "));
  console.log(`dropped (${dropped.length}):`);
  for (const d of dropped) console.log(`  - ${d.row.kind} ${d.row.company} [${d.band} ${d.filings ?? "?"}] ${d.why}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
