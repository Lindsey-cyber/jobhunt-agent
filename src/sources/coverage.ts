// Fetching for `jh coverage`: public lists the pipeline does not use, plus (read-only) the official
// boards of watched companies, to tell a stale list entry from a posting the pipeline missed.
// Never opens an application form: a link is only followed hop by hop for its Location header (HEAD), never rendered.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isAggregator, makeCanon, normCompany, notIndependent, parseListTable, urlsIn, watchBands, workdaySite, type Canon, type SampleRow, type SizeSources, type WatchedBoard } from "../discover/coverage.ts";
import { employerKey } from "../discover/h1b.ts";
import { atsOf, jobKey } from "../discover/identity.ts";
import type { EightfoldItem } from "../discover/parse.ts";
import { loadWatchlist, WORKDAY_PAGE, WORKDAY_PAGE_CAP, type BoardKind, type Watchlist } from "./fetch.ts";
import { getJson, getText, pool, postJson } from "./http.ts";

export interface SampleList {
  name: string;
  url: string;
  raw: string;
}

// Lists the pipeline does NOT fetch. Independence is re-checked on every run against config/watchlist.yaml.
export const SAMPLE_LISTS: SampleList[] = [
  { name: "jobright-ai/2026-Data-Analysis-New-Grad", url: "https://github.com/jobright-ai/2026-Data-Analysis-New-Grad", raw: "https://raw.githubusercontent.com/jobright-ai/2026-Data-Analysis-New-Grad/master/README.md" },
  { name: "jobright-ai/2026-Software-Engineer-New-Grad", url: "https://github.com/jobright-ai/2026-Software-Engineer-New-Grad", raw: "https://raw.githubusercontent.com/jobright-ai/2026-Software-Engineer-New-Grad/master/README.md" },
  // jobright-ai's umbrella list for engineering new grads (same table layout as the two above): carries the ML/AI/data-engineering
  // titles the two narrower jobright lists do not. Checked 2026-11-02: master/README.md, ~7500 rows, updated daily.
  { name: "jobright-ai/2026-Engineering-New-Grad", url: "https://github.com/jobright-ai/2026-Engineering-New-Grad", raw: "https://raw.githubusercontent.com/jobright-ai/2026-Engineering-New-Grad/master/README.md" },
  { name: "vanshb03/New-Grad-2027", url: "https://github.com/vanshb03/New-Grad-2027", raw: "https://raw.githubusercontent.com/vanshb03/New-Grad-2027/dev/README.md" },
];

// Every URL in the watchlist file, whatever section it is in.
export const watchlistUrls = (path = "config/watchlist.yaml"): string[] => urlsIn(readFileSync(path, "utf8"));

// Throws, naming each refused source, when a list is one the pipeline already fetches.
export function requireIndependent(lists: readonly SampleList[], watched: readonly string[]): void {
  const bad = lists.filter((l) => notIndependent([l.url, l.raw], watched).length > 0);
  if (bad.length) throw new Error(`refused: ${bad.map((l) => l.name).join(", ")} appear in config/watchlist.yaml, so a sample from them would not be independent`);
}

// Rows whose company is in config/watchlist.yaml `aggregators:` are left out: they repost other employers' jobs.
export async function fetchSample(lists: readonly SampleList[], aggregators: readonly string[] = loadWatchlist().aggregators, canon: Canon = normCompany): Promise<{ rows: SampleRow[]; failed: string[] }> {
  const rows: SampleRow[] = [];
  const failed: string[] = [];
  for (const l of lists) {
    try {
      rows.push(...parseListTable(l.name, await getText(l.raw, 120000)).filter((r) => !isAggregator(r.company, aggregators, canon)));
    } catch (e) {
      failed.push(`${l.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { rows, failed };
}

const UA = "jobhunt-agent/2 (personal job search; read-only)";
// A hop that asks for a login, a captcha or a bot check is a wall, not a posting: never followed or passed.
const WALL = /challenge|captcha|login|log-in|signin|sign-in|\/sso\b|security\/|verify|consent/i;
const MAX_HOPS = 6;

export interface ResolveOptions {
  // Where resolved links are remembered between runs (a link's target does not change within a day's lists).
  cachePath?: string;
  // Gap between two requests to the same host, in ms.
  hostGapMs?: number;
}

const hasAtsId = (url: string): boolean => atsOf(jobKey(url)) !== undefined;

// One hop, read-only: HEAD (GET when the server refuses HEAD), redirects not followed by fetch, body never read.
async function hop(url: string): Promise<{ status: number; location: string | null }> {
  const go = async (method: "HEAD" | "GET") => {
    const res = await fetch(url, { method, redirect: "manual", signal: AbortSignal.timeout(15000), headers: { "user-agent": UA, accept: "text/html,*/*" } });
    await res.body?.cancel().catch(() => undefined);
    return { status: res.status, location: res.headers.get("location") };
  };
  const head = await go("HEAD");
  return head.status === 405 || head.status === 501 ? go("GET") : head;
}

// Follows redirects hop by hop to the employer's own URL. Stops at the first URL that names an ATS posting (that page is
// never requested: the id is already in the link), at a page that is not a redirect, at a login or bot wall, at a loop or
// after MAX_HOPS. Undefined when nothing better than the link we started with was reached.
// `transient` is set when the walk ended at a network error, a 429 or a 5xx: that answer says nothing about the link.
async function walk(start: string, wait: (host: string) => Promise<void>): Promise<{ to: string | undefined; transient: boolean }> {
  let cur = start;
  const seen = new Set([start]);
  const end = (transient = false) => ({ to: cur === start ? undefined : cur, transient });
  for (let i = 0; i < MAX_HOPS; i++) {
    if (hasAtsId(cur)) return end();
    let r: { status: number; location: string | null };
    try {
      await wait(new URL(cur).hostname);
      r = await hop(cur);
    } catch {
      return end(true);
    }
    if (r.status === 429 || r.status >= 500) return end(true);
    if (r.status < 300 || r.status >= 400 || !r.location) return end();
    let next: string;
    try {
      next = new URL(r.location, cur).toString();
    } catch {
      return end();
    }
    if (WALL.test(new URL(next).pathname + new URL(next).search) || seen.has(next)) return end();
    seen.add(next);
    cur = next;
  }
  return end();
}

export async function followRedirects(start: string, wait: (host: string) => Promise<void> = async () => undefined): Promise<string | undefined> {
  return (await walk(start, wait)).to;
}

function loadCache(path: string | undefined): Record<string, string> {
  if (!path) return {};
  try {
    const v: unknown = JSON.parse(readFileSync(path, "utf8"));
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

// Every row's link, followed to its final official URL (list redirectors such as go.vansh.nyc point at the ATS page), so
// the posting is matched by its own JobKey and the stale check can read its id. Links that already name an ATS posting
// are left alone; links behind a wall stay as they were. Politely: four at a time, a gap per host, answers cached.
export async function resolveLinks(rows: readonly SampleRow[], opts: ResolveOptions = {}): Promise<SampleRow[]> {
  const { cachePath = join("data", "coverage", "link-cache.json"), hostGapMs = 250 } = opts;
  const cache = loadCache(cachePath);
  const last = new Map<string, number>();
  const wait = async (host: string) => {
    const at = Math.max(Date.now(), (last.get(host) ?? 0) + hostGapMs);
    last.set(host, at);
    if (at > Date.now()) await new Promise((r) => setTimeout(r, at - Date.now()));
  };
  const pending = new Map<string, ReturnType<typeof walk>>();
  const out = await pool([...rows], 4, async (r) => {
    const u = r.url;
    if (!u || !/^https?:/i.test(u) || hasAtsId(u)) return r;
    const cached = cache[u];
    if (cached) return { ...r, url: cached };
    let p = pending.get(u);
    if (!p) pending.set(u, (p = walk(u, wait)));
    const { to, transient } = await p;
    if (!to) return r;
    // A chain that ended in a transient error may be cut short: used for this run, never remembered.
    if (!transient) cache[u] = to;
    return { ...r, url: to };
  });
  if (cachePath && Object.keys(cache).length > 0) {
    try {
      mkdirSync(dirname(cachePath), { recursive: true });
      writeFileSync(cachePath, JSON.stringify(cache, null, 1) + "\n");
    } catch {
      // The cache is a courtesy to the lists' hosts; a run without it is just slower.
    }
  }
  return out;
}

// The name the command used before every redirector was followed.
export const resolveShortLinks = resolveLinks;

// Every posting a Workday board lists (empty search, all pages; Workday serves at most 2000 per search).
// Titles and requisition keys only, no detail pages. The board is `partial` (it can prove a posting live, never gone)
// unless every check holds: a positive whole-number total, no more pages than Workday serves, every page answered
// as a list, every posting has a requisition path the key can read, and every reported posting was listed.
interface WorkdayPage { total?: unknown; jobPostings?: unknown }
interface WorkdayPosting { title?: unknown; externalPath?: unknown }

export async function enumerateWorkday(site: string): Promise<WatchedBoard> {
  const u = new URL(site);
  const tenant = u.hostname.split(".")[0]!;
  const api = `https://${u.hostname}/wday/cxs/${tenant}${u.pathname.replace(/\/$/, "")}/jobs`;
  const board = workdaySite(site);
  const list = (offset: number) => postJson<WorkdayPage>(api, { appliedFacets: {}, limit: WORKDAY_PAGE, offset, searchText: "" }, 60000);
  let first: WorkdayPage;
  try {
    first = await list(0);
  } catch {
    return { ats: "workday", site: board };
  }
  // A page's postings, or undefined when the page is not a list (an error page, a refusal, a changed API).
  const postings = (p: WorkdayPage | undefined): WorkdayPosting[] | undefined => {
    const j = p?.jobPostings;
    return Array.isArray(j) ? (j as WorkdayPosting[]) : undefined;
  };
  // total is reported on the first page; later pages may say 0.
  const total = typeof first.total === "number" && Number.isInteger(first.total) && first.total > 0 ? first.total : undefined;
  const pagesNeeded = total === undefined ? 1 : Math.ceil(total / WORKDAY_PAGE);
  const offsets = Array.from({ length: Math.min(pagesNeeded, WORKDAY_PAGE_CAP) - 1 }, (_, i) => (i + 1) * WORKDAY_PAGE);
  const rest = await pool(offsets, 4, (o) => list(o).catch(() => undefined));
  const lists = [first, ...rest].map(postings);
  const posts = lists.flatMap((l) => l ?? []);
  const ids = posts.map((p) => (typeof p.externalPath === "string" && p.externalPath ? jobKey(`https://${u.hostname}${p.externalPath}`) : undefined));
  const partial =
    total === undefined ||
    pagesNeeded > WORKDAY_PAGE_CAP ||
    lists.some((l) => l === undefined) ||
    ids.some((k) => k === undefined || atsOf(k) !== "workday") ||
    posts.length < total;
  return {
    ats: "workday",
    site: board,
    titles: posts.map((p) => (typeof p.title === "string" ? p.title : "")),
    keys: ids.flatMap((k) => (k ? [k] : [])),
    partial,
  };
}

// The official board API of each ATS, and the public job page a posting's id belongs to.
const hostedUrl: Record<BoardKind, (board: string, id: string) => string> = {
  greenhouse: (b, id) => `https://job-boards.greenhouse.io/${b}/jobs/${id}`,
  lever: (b, id) => `https://jobs.lever.co/${b}/${id}`,
  ashby: (b, id) => `https://jobs.ashbyhq.com/${b}/${id}`,
};

interface BoardJob { id: string; title: string }

// Every job an official board lists, read from its own API before any parsing or filtering. Throws unless the
// answer is the list it should be (and, for Lever, every page came back); the caller then treats the board as unread.
async function boardJobs(kind: BoardKind, board: string): Promise<BoardJob[]> {
  const jobsOf = (v: unknown, idKey: string, titleKey: string): BoardJob[] => {
    if (!Array.isArray(v)) throw new Error(`${kind} ${board}: no job list`);
    return v.map((o: Record<string, unknown>) => {
      const id = o[idKey];
      const title = o[titleKey];
      if ((typeof id !== "string" && typeof id !== "number") || typeof title !== "string") throw new Error(`${kind} ${board}: a job without ${idKey}`);
      return { id: String(id), title };
    });
  };
  if (kind === "lever") {
    const all: BoardJob[] = [];
    for (let skip = 0; ; skip += 250) {
      if (skip > 250 * 40) throw new Error(`lever ${board}: page cap, listing incomplete`);
      const page = jobsOf(await getJson<unknown>(`https://api.lever.co/v0/postings/${board}?mode=json&limit=250&skip=${skip}`, 120000), "id", "text");
      all.push(...page);
      if (page.length < 250) break;
    }
    return all;
  }
  const url = kind === "greenhouse" ? `https://boards-api.greenhouse.io/v1/boards/${board}/jobs` : `https://api.ashbyhq.com/posting-api/job-board/${board}`;
  return jobsOf((await getJson<Record<string, unknown>>(url, 120000)).jobs, "id", "title");
}

// One watched board as it lists now: every title, and the JobKey of every posting. Unread (no titles, no keys) when
// the board cannot be read in full, so it can prove nothing.
export async function readBoard(kind: BoardKind, board: string): Promise<WatchedBoard> {
  try {
    const jobs = await boardJobs(kind, board);
    const keys = jobs.map((j) => jobKey(hostedUrl[kind](board, j.id)));
    if (keys.some((k) => atsOf(k) !== kind)) throw new Error(`${kind} ${board}: ids not readable`);
    return { ats: kind, board, titles: jobs.map((j) => j.title), keys };
  } catch {
    return { ats: kind, board };
  }
}

// What each watched company's official boards list now (Greenhouse, Lever, Ashby: the board API; Workday: the
// full enumeration), to tell a stale list entry from a posting the pipeline missed. Read-only.
export async function watchedBoards(companies: readonly string[], wl: Watchlist = loadWatchlist()): Promise<Map<string, WatchedBoard[]>> {
  const canon = makeCanon(wl.aliases);
  const want = new Set(companies.map(canon));
  const out = new Map<string, WatchedBoard[]>();
  const add = (c: string, b: WatchedBoard) => out.set(canon(c), [...(out.get(canon(c)) ?? []), b]);
  const jobs: { kind: BoardKind; b: { board: string; company: string } }[] = [];
  for (const kind of ["greenhouse", "lever", "ashby"] as const) for (const b of wl[kind]) if (want.has(canon(b.company))) jobs.push({ kind, b });
  await pool(jobs, 4, async ({ kind, b }) => add(b.company, await readBoard(kind, b.board)));
  await pool(wl.workday.filter((w) => want.has(canon(w.company))), 2, async (w) => add(w.company, await enumerateWorkday(w.site)));
  await pool(wl.eightfold.filter((e) => want.has(canon(e.company))), 2, async (e) => add(e.company, await enumerateEightfold(e)));
  return out;
}

// ---- Eightfold ------------------------------------------------------------------------------------

interface EfApply { count?: unknown; positions?: unknown }
// The server fixes the page size (10); a board of more than this many pages is not read in full.
export const EIGHTFOLD_PAGE_CAP = 400;

// Every position an Eightfold career site lists (empty search, no location filter, all pages), by its own API: the
// stale check for tenants the pipeline reads through search. Titles and ids only. `partial` (it can prove a posting
// live, never gone) unless: a positive whole-number count, within the page cap, every page answered as a list, every
// position has an id, and as many distinct positions came back as the count says.
export async function enumerateEightfold(e: Watchlist["eightfold"][number]): Promise<WatchedBoard> {
  const root = `https://${e.host}/api`;
  const dom = encodeURIComponent(e.domain);
  const page = async (start: number): Promise<{ count: unknown; items: EightfoldItem[] } | undefined> => {
    try {
      const qs = `domain=${dom}&start=${start}&query=`;
      const body = e.api === "pcsx" ? (await getJson<{ data?: EfApply }>(`${root}/pcsx/search?${qs}`, 60000)).data : await getJson<EfApply>(`${root}/apply/v2/jobs?${qs}&num=10`, 60000);
      return body && Array.isArray(body.positions) ? { count: body.count, items: body.positions as EightfoldItem[] } : undefined;
    } catch {
      return undefined;
    }
  };
  const first = await page(0);
  if (!first) return { ats: "eightfold" };
  const count = typeof first.count === "number" && Number.isInteger(first.count) && first.count > 0 ? first.count : undefined;
  const size = first.items.length;
  const pagesNeeded = count === undefined || size === 0 ? 1 : Math.ceil(count / size);
  const offsets = Array.from({ length: Math.min(pagesNeeded, EIGHTFOLD_PAGE_CAP) - 1 }, (_, i) => (i + 1) * size);
  const rest = await pool(offsets, 4, page);
  const pages = [first, ...rest];
  const items = new Map<string, EightfoldItem>();
  let noId = false;
  for (const p of pages) for (const it of p?.items ?? []) (it.id === undefined || it.id === null ? (noId = true) : items.set(String(it.id), it));
  const keys = [...items.keys()].map((id) => jobKey(`https://${e.host}/careers/job/${id}`));
  const partial = count === undefined || pagesNeeded > EIGHTFOLD_PAGE_CAP || pages.some((p) => p === undefined) || noId || keys.some((k) => atsOf(k) !== "eightfold") || items.size < count;
  return { ats: "eightfold", titles: [...items.values()].map((it) => it.posting_name || it.name || ""), keys, partial };
}

// A link into a career site by its own position id (jobs.nvidia.com/careers/job/893397927110) is a different id from the
// ATS requisition the pipeline keys the same posting by (Workday JR2026576). The site's own position details name the
// requisition (displayJobId), so the row is matched by it. Read-only, one request per distinct link; a link that answers
// nothing useful is left as it was.
export async function resolveRequisitions(rows: readonly SampleRow[], wl: Watchlist = loadWatchlist()): Promise<SampleRow[]> {
  const domains = new Map(wl.eightfold.map((e) => [e.host.toLowerCase(), e.domain]));
  const memo = new Map<string, Promise<string | undefined>>();
  const lookup = (host: string, id: string): Promise<string | undefined> => {
    const k = `${host}/${id}`;
    let p = memo.get(k);
    if (!p) {
      const dom = domains.get(host) ?? host.split(".").slice(-2).join(".");
      p = getJson<{ data?: { displayJobId?: unknown } }>(`https://${host}/api/pcsx/position_details?position_id=${encodeURIComponent(id)}&domain=${encodeURIComponent(dom)}&hl=en`, 30000)
        .then((d) => (typeof d.data?.displayJobId === "string" || typeof d.data?.displayJobId === "number" ? String(d.data.displayJobId).trim().toLowerCase() || undefined : undefined))
        .catch(() => undefined);
      memo.set(k, p);
    }
    return p;
  };
  return pool([...rows], 4, async (r) => {
    const m = r.url ? /^eightfold:([^:]+):(\d+)$/.exec(jobKey(r.url)) : null;
    if (!m) return r;
    const requisition = await lookup(m[1]!, m[2]!);
    return requisition ? { ...r, requisition } : r;
  });
}

// ---- Size bands -------------------------------------------------------------------------------------

type Counts = Record<string, { filings?: unknown; since?: unknown } | undefined>;
const readCounts = (path: string): Counts => {
  try {
    const v: unknown = JSON.parse(readFileSync(path, "utf8"));
    return v && typeof v === "object" ? (v as Counts) : {};
  } catch {
    return {};
  }
};

// Where each employer's size comes from: the watchlist's band (its boards and its pending list), else H-1B filings since the
// policy year from data/h1b (the watchlist's own counts first, then the lookup cache). `since` is the policy year: a count
// taken since another year is not comparable and is ignored.
export function loadSizeSources(dataDir: string, since: number | null, wl: Watchlist = loadWatchlist(), canon: Canon = makeCanon(wl.aliases)): SizeSources {
  const entries = [...wl.greenhouse, ...wl.lever, ...wl.ashby, ...wl.workday, ...wl.smartrecruiters, ...wl.oracleHcm, ...wl.eightfold, ...wl.pending];
  const own = readCounts(join(dataDir, "h1b", "watchlist-counts.json"));
  const cache = readCounts(join(dataDir, "h1b", "sponsors.json"));
  const count = (c: Counts[string], checkSince: boolean): number | undefined =>
    c && typeof c.filings === "number" && Number.isFinite(c.filings) && (!checkSince || since === null || c.since === undefined || c.since === since) ? c.filings : undefined;
  return {
    watch: watchBands(entries, canon),
    filings: (company) => {
      const k = employerKey(company);
      return count(own[k], true) ?? count(cache[k], false);
    },
  };
}

