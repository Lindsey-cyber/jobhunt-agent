// Rebuilds config/watchlist.yaml from data: H-1B filing counts (size proxy), catalog history, policy.
// Usage: npx tsx scripts/rebuild-watchlist.ts [--offline] [--refresh-h1b] [--dry]
//   --offline      no network: use cached H-1B counts, discover no new boards
//   --refresh-h1b  look every company up again (default: only companies with no cached record)
//   --dry          print the report, write nothing
// Read-only toward employers (public board APIs and h1bdata.info); never opens an application form.
// Writes config/watchlist.yaml and data/h1b/sponsors.json. Keeps workdayQueries, github, hn, skipped as they are.
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "yaml";
import { employerKey, filerName, parseH1bTable, recordFrom, SINCE_YEAR, type H1bFiling, type H1bRecord } from "../src/discover/h1b.ts";
import { excludedBy } from "../src/discover/exclude.ts";
import { ROLE } from "../src/discover/triage.ts";
import { getJson, getText, pool } from "../src/sources/http.ts";
import { readCatalog } from "../src/store/catalog.ts";
import { readH1b, writeH1b } from "../src/store/h1b.ts";

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

export const CHECK_YEAR_FROM = SINCE_YEAR;

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

// ---------- data ----------

const NOW = new Date(process.env.WATCHLIST_NOW ?? Date.now());
const WATCHLIST = "config/watchlist.yaml";
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

async function lookupAllYears(company: string, checkedAt: string): Promise<H1bRecord | undefined> {
  const q2 = encodeURIComponent(filerName(company) || company.trim()).replace(/%20/g, "+");
  const filings: H1bFiling[] = [];
  try {
    for (let y = Number(checkedAt.slice(0, 4)); y >= SINCE_YEAR; y--) {
      const html = await getText(`https://h1bdata.info/index.php?em=${q2}&job=&city=&year=${y}`, 60000);
      if (!/<th>EMPLOYER<\/th>/i.test(html) && !/no results|0 results/i.test(html)) return undefined; // throttled page, not "no filings"
      filings.push(...parseH1bTable(html));
    }
  } catch {
    return undefined;
  }
  return recordFrom(company, filings, checkedAt);
}

async function ensureH1b(companies: string[], cache: Map<string, H1bRecord>, refresh: boolean): Promise<number> {
  const todo = [...new Map(companies.map((c) => [employerKey(c), c])).entries()].filter(([k]) => refresh || !cache.has(k)).map(([, c]) => c);
  let done = 0, failed = 0;
  const checkedAt = NOW.toISOString();
  await pool(todo, 6, async (c) => {
    const r = await lookupAllYears(c, checkedAt);
    if (r) cache.set(employerKey(c), r); else failed++;
    if (++done % 100 === 0) {
      writeH1b("data", cache);
      console.error(`h1b lookups ${done}/${todo.length} (${failed} failed)`);
    }
  });
  writeH1b("data", cache);
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
  const policy = parse(readFileSync("data/policy.yaml", "utf8")) as { excludeCompanies: string[] };
  const exclude = policy.excludeCompanies;
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

  const cache = readH1b("data");
  const onList = rows.map((r) => r.company);
  const candidates: string[] = [...COVERAGE_MISSES];
  // Companies in the catalog that hire for AI/ML but are not watched (big ones are added below).
  const watched = new Set(onList.map(employerKey));
  // Pending entries with no ATS named are looked at again each run.
  const oldPending = allPending.filter((p) => p.ats !== "unknown" && !/^Workday \(site not confirmed/.test(p.ats));
  const pendingKeys = new Set(oldPending.map((p) => employerKey(p.company)));
  const extra = [...byKey].filter(([k, h]) => h.mlTitle && !watched.has(k) && !pendingKeys.has(k) && !excludedBy(display.get(k)!, exclude)).map(([k]) => display.get(k)!);
  candidates.push(...extra);

  if (!offline) await ensureH1b([...onList, ...candidates], cache, arg("--refresh-h1b"));
  const filingsOf = (c: string): number | undefined => cache.get(employerKey(c))?.filings;

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

  // Write the file: company sections regenerated, the rest kept verbatim.
  const lines = text.split("\n");
  const at = (re: RegExp) => lines.findIndex((l) => re.test(l));
  const iQueries = at(/^workdayQueries:/), iWorkday = at(/^workday:/), iGithub = at(/^github:/), iPending = at(/^pending:/);
  const queries = lines.slice(iQueries, iWorkday).join("\n");
  const tail = lines.slice(iGithub, iPending > iGithub ? iPending : undefined).join("\n").trimEnd();
  const all = [...kept.map((r) => ({ ...r })), ...added];
  const section = (k: Kind) => all.filter((r) => r.kind === k).map((r) => renderEntry({ ...r, kind: k })).join("\n");
  const out = [
    "# Long-running watchlist of official ATS boards, rebuilt by scripts/rebuild-watchlist.ts (rerun it; do not hand-edit counts).",
    "# size: medium_large when the employer filed >= 20 H-1B LCAs since 2023 (band large >= 200, mid 20-199), else unknown (band small < 20,",
    "# unknown = not looked up). h1b is the filing count (data/h1b/sponsors.json). ai: true marks AI-first companies.",
    "# Kept: a triage match in the last 180 days, or large/mid with an ML/AI/data title in catalog history. Dropped only with no match ever,",
    "# no ML/AI/data title ever, and not large/mid; excluded companies (data/policy.yaml) are not watched.",
    "# pending: big sponsors whose board is on an ATS with no adapter yet (another workstream adds adapters).",
    "greenhouse:", section("greenhouse"), "lever:", section("lever"), "ashby:", section("ashby"),
    queries.trimEnd(), "workday:", section("workday"), tail,
    ...(pending.length ? ["pending:", ...pending.map(renderPending)] : []),
    "",
  ].join("\n");
  if (!dry) writeFileSync(WATCHLIST, out);

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
