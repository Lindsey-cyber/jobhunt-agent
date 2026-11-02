import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import type { Channel, Sighting, SizeBand } from "../domain/job.ts";
import { ROLE } from "../discover/triage.ts";
import { parseAmazon, parseAshby, parseGreenhouse, parseHnComment, parseLever, parseMarkdownJobTable, parseOracleHcm, parseSimplifyListings, parseSmartRecruiters, parseWorkdayDetail, parseWorkdayPostedOn, type HnComment, type OracleHcmDetail, type OracleHcmItem, type SmartRecruitersDetail, type SmartRecruitersItem, type WorkdayDetail } from "../discover/parse.ts";
import { getJson, getText, HttpError, pool, postJson } from "./http.ts";

const Board = z.object({ board: z.string(), company: z.string(), size: z.enum(["medium_large", "unknown"]).default("unknown"), ai: z.boolean().default(false) });
export const Watchlist = z.object({
  greenhouse: z.array(Board).default([]),
  lever: z.array(Board).default([]),
  ashby: z.array(Board).default([]),
  workdayQueries: z.array(z.string()).default(["new grad", "machine learning"]),
  workday: z.array(z.object({ site: z.url(), company: z.string(), size: z.enum(["medium_large", "unknown"]).default("unknown") })).default([]),
  // Public job-list APIs of two more ATS families (SmartRecruiters Posting API,
  // Oracle HCM Candidate Experience). Searched with workdayQueries, US only.
  smartrecruiters: z.array(z.object({ id: z.string(), company: z.string(), size: z.enum(["medium_large", "unknown"]).default("unknown") })).default([]),
  oracleHcm: z.array(z.object({ host: z.string(), site: z.string(), company: z.string(), size: z.enum(["medium_large", "unknown"]).default("unknown") })).default([]),
  // Amazon's career site JSON search (no ATS board exists): AND-matched keyword queries, US only.
  amazon: z.object({ queries: z.array(z.string()) }).optional(),
  github: z.array(z.object({ name: z.string(), url: z.url(), raw: z.url(), format: z.enum(["simplify-json", "markdown"]) })).default([]),
  hn: z.object({ commentLimit: z.number().int().default(300) }).default({ commentLimit: 300 }),
  skipped: z.array(z.object({ name: z.string(), reason: z.string() })).default([]),
});
export type Watchlist = z.infer<typeof Watchlist>;
export type BoardKind = "greenhouse" | "lever" | "ashby";

export const loadWatchlist = (path = "config/watchlist.yaml") => Watchlist.parse(parse(readFileSync(path, "utf8")));

export interface SourceOutcome {
  name: string;
  channel: Channel;
  url: string;
  ok: boolean;
  count: number;
  error?: string;
  note?: string;
  // Workday full walk: list pages fetched, postings listed, and whether recall is still bounded (cap hit or fallback).
  pages?: number;
  listed?: number;
  capHit?: boolean;
  size?: SizeBand;
  // Set for boards found through a third-party listing rather than the watchlist.
  discoveredFrom?: string;
}

export interface Fetched {
  sightings: Sighting[];
  outcome: SourceOutcome;
}

const fail = (o: Omit<SourceOutcome, "ok" | "count">, e: unknown): Fetched => ({ sightings: [], outcome: { ...o, ok: false, count: 0, error: e instanceof Error ? e.message : String(e) } });

// Open-posting count as a size proxy for boards with no curated band.
const sizeOf = (declared: "medium_large" | "unknown", count: number): SizeBand => (declared === "medium_large" ? "medium_large" : count <= 30 ? "small_proxy" : "unknown");

export async function fetchBoard(kind: BoardKind, b: { board: string; company: string; size?: "medium_large" | "unknown" }, seenAt: string): Promise<Fetched> {
  const channel: Channel = `official_${kind}`;
  const base = { name: b.company, channel };
  try {
    if (kind === "greenhouse") {
      const url = `https://boards-api.greenhouse.io/v1/boards/${b.board}/jobs?content=true`;
      const s = parseGreenhouse(await getJson(url, 120000), b.board, b.company, seenAt);
      return { sightings: s, outcome: { ...base, url: `https://job-boards.greenhouse.io/${b.board}`, ok: true, count: s.length, size: sizeOf(b.size ?? "unknown", s.length) } };
    }
    if (kind === "lever") {
      const all: Parameters<typeof parseLever>[0] = [];
      for (let skip = 0; ; skip += 250) {
        const page = await getJson<typeof all>(`https://api.lever.co/v0/postings/${b.board}?mode=json&limit=250&skip=${skip}`, 120000);
        all.push(...page);
        if (page.length < 250) break;
      }
      const s = parseLever(all, b.board, b.company, seenAt);
      return { sightings: s, outcome: { ...base, url: `https://jobs.lever.co/${b.board}`, ok: true, count: s.length, size: sizeOf(b.size ?? "unknown", s.length) } };
    }
    const s = parseAshby(await getJson(`https://api.ashbyhq.com/posting-api/job-board/${b.board}`, 120000), b.board, b.company, seenAt);
    return { sightings: s, outcome: { ...base, url: `https://jobs.ashbyhq.com/${b.board}`, ok: true, count: s.length, size: sizeOf(b.size ?? "unknown", s.length) } };
  } catch (e) {
    return fail({ ...base, url: `${kind}:${b.board}` }, e);
  }
}

interface WorkdayList { total?: number; jobPostings?: { title?: string; externalPath?: string; postedOn?: string }[] }
type WorkdayPosting = NonNullable<WorkdayList["jobPostings"]>[number];

export interface WorkdayOptions {
  // Hard cap on list pages per board (20 postings each), so one huge board cannot starve the rest.
  pageCap?: number;
  // ISO time of the last successful run for this board: postings dated before it are stale.
  since?: string;
  // Consecutive pages made up entirely of stale postings that end the walk. Pages, not postings:
  // Adobe lists a run of 20+ "30+ Days Ago" postings in the middle of fresh ones.
  stalePages?: number;
  // Per-query depth of the keyword fallback, in postings.
  perQuery?: number;
}

export const WORKDAY_PAGE = 20;
// Workday itself serves at most 2000 postings per search (100 pages of 20).
export const WORKDAY_PAGE_CAP = 100;

// A posting is stale when it is older than the window: "30+ days" is always
// outside it, and so is anything dated before the last successful run.
function workdayStale(postedOn: string | undefined, seenAt: string, since?: string): boolean {
  const r = parseWorkdayPostedOn(postedOn, seenAt);
  if (!r) return false;
  if (r.dateKind === "posted_before") return true;
  return since !== undefined && r.date < since;
}

// Workday lists postings newest first, so a board is read in full but
// incrementally: empty search, page by page, until the postings are older than
// the window. Keyword search is only the fallback for a board that rejects an
// empty search. Only titles that look like AI/ML roles get their detail fetched.
export async function fetchWorkday(w: Watchlist["workday"][number], queries: string[], seenAt: string, opts: WorkdayOptions = {}): Promise<Fetched> {
  const { pageCap = WORKDAY_PAGE_CAP, since, stalePages = 2, perQuery = 60 } = opts;
  const u = new URL(w.site);
  const tenant = u.hostname.split(".")[0]!;
  const api = `https://${u.hostname}/wday/cxs/${tenant}${u.pathname.replace(/\/$/, "")}`;
  const base = { name: w.company, channel: "official_workday" as Channel, url: w.site };
  try {
    const paths = new Map<string, { title: string; postedOn: string }>();
    let listed = 0;
    const take = (posts: WorkdayPosting[]) => {
      for (const p of posts) {
        if (!p.externalPath) continue;
        listed++;
        if (ROLE.test(p.title ?? "")) paths.set(p.externalPath, { title: p.title ?? "", postedOn: p.postedOn ?? "" });
      }
    };
    const list = (offset: number, searchText: string) => postJson<WorkdayList>(`${api}/jobs`, { appliedFacets: {}, limit: WORKDAY_PAGE, offset, searchText }, 60000);

    let mode = "full";
    let pages = 0;
    let capHit = false;
    let stopReason = "";
    let first: WorkdayList | undefined;
    try {
      first = await list(0, "");
    } catch (e) {
      // 4xx other than rate limiting means the board refuses an empty search.
      if (!(e instanceof HttpError) || e.status >= 500 || e.status === 429) throw e;
    }
    if (first) {
      pages = 1;
      let page: WorkdayList = first;
      const total = first.total ?? 0;
      let stale = 0;
      for (let offset = 0; ; offset += WORKDAY_PAGE) {
        const posts = page.jobPostings ?? [];
        if (posts.length === 0) { stopReason = "end of list"; break; }
        take(posts);
        stale = posts.every((p) => workdayStale(p.postedOn, seenAt, since)) ? stale + 1 : 0;
        if (stale >= stalePages) { stopReason = "reached postings older than the window"; break; }
        // total is reported on the first page only; later pages may say 0.
        if (offset + WORKDAY_PAGE >= total || posts.length < WORKDAY_PAGE) { stopReason = "end of list"; break; }
        if (pages >= pageCap) { capHit = true; stopReason = `page cap ${pageCap}`; break; }
        try {
          page = await list(offset + WORKDAY_PAGE, "");
        } catch (e) {
          stopReason = `error after ${pages} pages: ${e instanceof Error ? e.message : String(e)}`;
          capHit = true; // recall is bounded here as surely as by the cap
          break;
        }
        pages++;
      }
    } else {
      mode = "keyword fallback";
      for (const q of queries) {
        for (let offset = 0; offset < perQuery; offset += WORKDAY_PAGE) {
          const page = await list(offset, q);
          pages++;
          take(page.jobPostings ?? []);
          if (offset + WORKDAY_PAGE >= (page.total ?? 0)) break;
        }
      }
      capHit = true; // keyword search never covers the whole board
      stopReason = `${queries.length} keyword searches`;
    }
    const details = await pool([...paths.keys()], 4, async (path) => {
      try {
        return parseWorkdayDetail(await getJson<WorkdayDetail>(api + path, 60000), w.site, path, w.company, seenAt, paths.get(path)?.postedOn);
      } catch {
        return undefined;
      }
    });
    const s = details.filter((d): d is Sighting => Boolean(d));
    return {
      sightings: s,
      outcome: {
        ...base, ok: true, count: s.length, size: w.size,
        pages, capHit, listed,
        note: `${mode}: ${pages} pages, ${listed} listed, ${paths.size} AI/ML titles, ${s.length} details read; stopped: ${stopReason}${capHit ? "; recall bounded here" : ""}`,
      },
    };
  } catch (e) {
    return fail(base, e);
  }
}

interface SrList { totalFound?: number; content?: SmartRecruitersItem[] }

// SmartRecruiters Posting API (api.smartrecruiters.com/v1, public, no key).
// Bounded keyword searches restricted to US postings; AI/ML-looking titles get
// their detail read for the description.
export async function fetchSmartRecruiters(c: Watchlist["smartrecruiters"][number], queries: string[], seenAt: string, perQuery = 100): Promise<Fetched> {
  const base = { name: c.company, channel: "official_smartrecruiters" as Channel, url: `https://jobs.smartrecruiters.com/${c.id}` };
  const api = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(c.id)}/postings`;
  try {
    const hits = new Map<string, SmartRecruitersItem>();
    let listed = 0;
    for (const q of queries) {
      for (let offset = 0; offset < perQuery; offset += 100) {
        const page = await getJson<SrList>(`${api}?limit=100&offset=${offset}&country=us&q=${encodeURIComponent(q)}`, 60000);
        for (const p of page.content ?? []) {
          listed++;
          if (ROLE.test(p.name ?? "")) hits.set(p.id, p);
        }
        if (offset + 100 >= (page.totalFound ?? 0)) break;
      }
    }
    const details = await pool([...hits.values()], 4, async (item) => {
      try {
        return parseSmartRecruiters(await getJson<SmartRecruitersDetail>(`${api}/${item.id}`, 60000), c.id, c.company, seenAt);
      } catch {
        return parseSmartRecruiters(item, c.id, c.company, seenAt);
      }
    });
    const s = details.filter((d): d is Sighting => Boolean(d));
    return { sightings: s, outcome: { ...base, ok: true, count: s.length, size: c.size, note: `${queries.length} searches, ${listed} US results, ${hits.size} AI/ML titles` } };
  } catch (e) {
    return fail(base, e);
  }
}

interface OracleList { items?: { requisitionList?: OracleHcmItem[]; TotalJobsCount?: number }[] }
interface OracleDetail { items?: OracleHcmDetail[] }

// Oracle HCM Candidate Experience REST (hcmRestApi, the endpoint the public
// career site itself calls; no login). Same bounded-search shape as Workday.
export async function fetchOracleHcm(o: Watchlist["oracleHcm"][number], queries: string[], seenAt: string, perQuery = 100): Promise<Fetched> {
  const root = `https://${o.host}/hcmRestApi/resources/latest`;
  const base = { name: o.company, channel: "official_oracle_hcm" as Channel, url: `https://${o.host}/hcmUI/CandidateExperience/en/sites/${o.site}` };
  try {
    const hits = new Map<string, OracleHcmItem>();
    let listed = 0;
    for (const q of queries) {
      for (let offset = 0; offset < perQuery; offset += 25) {
        const finder = `findReqs;siteNumber=${o.site},limit=25,offset=${offset},sortBy=POSTING_DATES_DESC,keyword="${q}"`;
        const body = await getJson<OracleList>(`${root}/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=${encodeURIComponent(finder)}`, 60000);
        const top = body.items?.[0];
        for (const p of top?.requisitionList ?? []) {
          if (p.PrimaryLocationCountry !== "US") continue;
          listed++;
          if (ROLE.test(p.Title ?? "")) hits.set(p.Id, p);
        }
        if (offset + 25 >= (top?.TotalJobsCount ?? 0)) break;
      }
    }
    const details = await pool([...hits.values()], 4, async (item) => {
      try {
        const finder = `ById;Id="${item.Id}",siteNumber=${o.site}`;
        const d = await getJson<OracleDetail>(`${root}/recruitingCEJobRequisitionDetails?onlyData=true&finder=${encodeURIComponent(finder)}`, 60000);
        return parseOracleHcm({ ...item, ...(d.items?.[0] ?? {}) }, o.host, o.site, o.company, seenAt);
      } catch {
        return parseOracleHcm(item, o.host, o.site, o.company, seenAt);
      }
    });
    const s = details.filter((d): d is Sighting => Boolean(d));
    return { sightings: s, outcome: { ...base, ok: true, count: s.length, size: o.size, note: `${queries.length} searches, ${listed} US results, ${hits.size} AI/ML titles` } };
  } catch (e) {
    return fail(base, e);
  }
}

// amazon.jobs/en/search.json: the endpoint the public search page calls; no login.
// Newest first, so a bounded page count keeps the recent postings of each query.
export async function fetchAmazon(queries: string[], seenAt: string, perQuery = 200): Promise<Fetched> {
  const base = { name: "Amazon", channel: "official_amazon" as Channel, url: "https://www.amazon.jobs/en/search" };
  try {
    const seen = new Map<string, Sighting>();
    let listed = 0;
    for (const q of queries) {
      for (let offset = 0; offset < perQuery; offset += 100) {
        const body = await getJson<{ hits?: number; jobs?: Parameters<typeof parseAmazon>[0]["jobs"] }>(`https://www.amazon.jobs/en/search.json?base_query=${encodeURIComponent(q)}&country%5B%5D=USA&result_limit=100&offset=${offset}&sort=recent`, 60000);
        const page = parseAmazon(body, seenAt);
        listed += page.length;
        for (const s of page) if (ROLE.test(s.title)) seen.set(s.key, s);
        if (offset + 100 >= (body.hits ?? 0)) break;
      }
    }
    const s = [...seen.values()];
    return { sightings: s, outcome: { ...base, ok: true, count: s.length, size: "medium_large", note: `${queries.length} searches, ${listed} US results, ${s.length} AI/ML titles` } };
  } catch (e) {
    return fail(base, e);
  }
}

// ── One posting by its own URL ─────────────────────────────────────────────
// A third-party list (GitHub, an alert) points at a posting on an ATS whose
// board is not on the watchlist. The employer's API answers for that one
// posting: its own publication date, and its text for triage. A posting the
// API no longer knows (closed, 4xx, absent from the list) yields nothing:
// no date is made up for it.

export type LookupKind = "workday" | "smartrecruiters" | "amazon" | "greenhouse" | "lever";
export const LOOKUP_KINDS: readonly LookupKind[] = ["workday", "smartrecruiters", "amazon", "greenhouse", "lever"];

export interface WorkdayRef { host: string; tenant: string; site: string; path: string; req: string }

// https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Austin-TX/ML-Engineer_R-123
// gives site Careers (the locale segment is not part of the site) and requisition R-123.
export function workdayRef(url: string): WorkdayRef | undefined {
  let u: URL;
  try { u = new URL(url); } catch { return undefined; }
  if (!u.hostname.endsWith(".myworkdayjobs.com")) return undefined;
  const parts = u.pathname.split("/").filter(Boolean);
  const i = parts.indexOf("job");
  if (i < 1) return undefined;
  const site = parts.slice(0, i).filter((p) => !/^[a-z]{2}-[A-Z]{2}$/.test(p)).at(-1);
  const req = /_([A-Za-z]*-?\d[\w-]*)$/.exec(parts.at(-1) ?? "")?.[1];
  if (!site || !req) return undefined;
  return { host: u.hostname, tenant: u.hostname.split(".")[0]!, site, path: "/" + parts.slice(i).join("/"), req };
}

// Greenhouse and Lever hosted URLs name the board in the first path segment; an
// employer-domain link (?gh_jid=) does not, so it cannot be looked up.
export function hostedBoard(url: string): { kind: "greenhouse" | "lever"; board: string; id: string } | undefined {
  let u: URL;
  try { u = new URL(url); } catch { return undefined; }
  const parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (u.hostname.endsWith("greenhouse.io") && parts[0] && parts[0] !== "embed" && parts[1] === "jobs" && /^\d+$/.test(parts[2] ?? "")) return { kind: "greenhouse", board: parts[0], id: parts[2]! };
  if (u.hostname === "jobs.lever.co" && parts[0] && parts[1]) return { kind: "lever", board: parts[0], id: parts[1] };
  return undefined;
}

export interface LookupTarget { url: string; company: string }

// A 4xx other than rate limiting means the API does not know the posting.
const unknownPosting = (e: unknown): [] => {
  if (e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 429) return [];
  throw e;
};

async function lookupOne(kind: LookupKind, t: LookupTarget, seenAt: string): Promise<Sighting[]> {
  try {
    if (kind === "smartrecruiters") {
      const parts = new URL(t.url).pathname.split("/").filter(Boolean);
      const id = /^\d+/.exec(parts[1] ?? "")?.[0];
      if (!parts[0] || !id) return [];
      const s = parseSmartRecruiters(await getJson<SmartRecruitersDetail>(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(parts[0])}/postings/${id}`, 60000), parts[0], t.company, seenAt);
      return s ? [s] : [];
    }
    if (kind === "amazon") {
      const id = /\/jobs\/(\d+)/.exec(new URL(t.url).pathname)?.[1];
      if (!id) return [];
      const body = await getJson<{ jobs?: Parameters<typeof parseAmazon>[0]["jobs"] }>(`https://www.amazon.jobs/en/search.json?base_query=${id}&result_limit=10`, 60000);
      return parseAmazon(body, seenAt).filter((s) => s.key === `amazon:${id}`);
    }
    if (kind === "greenhouse" || kind === "lever") {
      const h = hostedBoard(t.url);
      if (!h || h.kind !== kind) return [];
      if (kind === "greenhouse") {
        const job = await getJson<NonNullable<Parameters<typeof parseGreenhouse>[0]["jobs"]>[number]>(`https://boards-api.greenhouse.io/v1/boards/${h.board}/jobs/${h.id}?content=true`, 60000);
        return parseGreenhouse({ jobs: [job] }, h.board, t.company, seenAt);
      }
      const job = await getJson<Parameters<typeof parseLever>[0][number]>(`https://api.lever.co/v0/postings/${h.board}/${h.id}`, 60000);
      return parseLever([job], h.board, t.company, seenAt);
    }
    const w = workdayRef(t.url);
    if (!w) return [];
    const api = `https://${w.host}/wday/cxs/${w.tenant}/${w.site}`;
    // The list is searched by requisition id; a posting no longer listed is closed.
    const list = await postJson<WorkdayList>(`${api}/jobs`, { appliedFacets: {}, limit: 20, offset: 0, searchText: w.req }, 60000);
    const req = w.req.toLowerCase();
    const hit = (list.jobPostings ?? []).find((p) => { const x = (p.externalPath ?? "").toLowerCase(); return x.endsWith(`_${req}`); });
    if (!hit?.externalPath) return [];
    const d = parseWorkdayDetail(await getJson<WorkdayDetail>(api + hit.externalPath, 60000), `https://${w.host}/${w.site}`, hit.externalPath, t.company, seenAt, hit.postedOn);
    return d ? [d] : [];
  } catch (e) {
    return unknownPosting(e);
  }
}

// Looks up each target on its ATS: the official sightings found, and one outcome
// saying how many were asked, found, no longer listed, and failed.
export async function fetchPostings(kind: LookupKind, targets: LookupTarget[], seenAt: string): Promise<Fetched> {
  const base = { name: `${kind} postings found through lists`, channel: `official_${kind}` as Channel, url: `lookup:${kind}` };
  let failed = 0;
  const found = await pool(targets, 4, async (t) => {
    try {
      return await lookupOne(kind, t, seenAt);
    } catch {
      failed++;
      return [] as Sighting[];
    }
  });
  const s = found.flat();
  return { sightings: s, outcome: { ...base, ok: failed < targets.length || targets.length === 0, count: s.length, note: `${targets.length} postings looked up, ${s.length} found on the employer's API, ${targets.length - s.length - failed} not found or no longer listed, ${failed} failed` } };
}

export async function fetchGithub(g: Watchlist["github"][number], seenAt: string): Promise<Fetched> {
  const base = { name: g.name, channel: "github_newgrad" as Channel, url: g.url };
  try {
    const all = g.format === "simplify-json" ? parseSimplifyListings(await getJson(g.raw, 120000), g.url, seenAt) : parseMarkdownJobTable(await getText(g.raw), g.url, seenAt);
    // Rows the list itself marks closed are history, not openings.
    const s = all.filter((x) => !x.hints.closed);
    const note = s.length === 0 ? "zero open rows parsed; the list format may have changed" : `${all.length - s.length} rows marked closed by the list were skipped`;
    return { sightings: s, outcome: { ...base, ok: true, count: s.length, note } };
  } catch (e) {
    return fail(base, e);
  }
}

interface HnItem { id: number; title?: string; kids?: number[]; time?: number }

export async function fetchHn(limit: number, seenAt: string): Promise<Fetched> {
  const base = { name: "HN Who is hiring", channel: "hn_hiring" as Channel, url: "https://news.ycombinator.com/submitted?id=whoishiring" };
  try {
    const user = await getJson<{ submitted?: number[] }>("https://hacker-news.firebaseio.com/v0/user/whoishiring.json");
    let thread: HnItem | undefined;
    for (const id of (user.submitted ?? []).slice(0, 12)) {
      const item = await getJson<HnItem>(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      if (item.title?.startsWith("Ask HN: Who is hiring?")) {
        thread = item;
        break;
      }
    }
    if (!thread) return { sightings: [], outcome: { ...base, ok: true, count: 0, note: "no current thread found" } };
    const kids = (thread.kids ?? []).slice(0, limit);
    const comments = await pool(kids, 12, (id) => getJson<HnComment>(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => undefined));
    const s = comments.flatMap((c) => (c ? parseHnComment(c, thread.id, seenAt) : []));
    return {
      sightings: s,
      outcome: { ...base, url: `https://news.ycombinator.com/item?id=${thread.id}`, ok: true, count: s.length, note: `${thread.title}; ${kids.length} of ${thread.kids?.length ?? 0} top-level posts read` },
    };
  } catch (e) {
    return fail(base, e);
  }
}
