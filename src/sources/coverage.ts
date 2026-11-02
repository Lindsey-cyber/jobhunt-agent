// Fetching for `jh coverage`: public lists the pipeline does not use, plus (read-only) the official
// boards of watched companies, to tell a stale list entry from a posting the pipeline missed.
// Never opens an application form: a link is only followed hop by hop for its Location header (HEAD), never rendered.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { normCompany, notIndependent, parseListTable, urlsIn, workdaySite, type SampleRow, type WatchedBoard } from "../discover/coverage.ts";
import { atsOf, jobKey } from "../discover/identity.ts";
import { loadWatchlist, WORKDAY_PAGE, WORKDAY_PAGE_CAP, type BoardKind } from "./fetch.ts";
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
  { name: "vanshb03/New-Grad-2027", url: "https://github.com/vanshb03/New-Grad-2027", raw: "https://raw.githubusercontent.com/vanshb03/New-Grad-2027/dev/README.md" },
];

// Every URL in the watchlist file, whatever section it is in.
export const watchlistUrls = (path = "config/watchlist.yaml"): string[] => urlsIn(readFileSync(path, "utf8"));

// Throws, naming each refused source, when a list is one the pipeline already fetches.
export function requireIndependent(lists: readonly SampleList[], watched: readonly string[]): void {
  const bad = lists.filter((l) => notIndependent([l.url, l.raw], watched).length > 0);
  if (bad.length) throw new Error(`refused: ${bad.map((l) => l.name).join(", ")} appear in config/watchlist.yaml, so a sample from them would not be independent`);
}

export async function fetchSample(lists: readonly SampleList[]): Promise<{ rows: SampleRow[]; failed: string[] }> {
  const rows: SampleRow[] = [];
  const failed: string[] = [];
  for (const l of lists) {
    try {
      rows.push(...parseListTable(l.name, await getText(l.raw, 120000)));
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
export async function followRedirects(start: string, wait: (host: string) => Promise<void> = async () => undefined): Promise<string | undefined> {
  let cur = start;
  const seen = new Set([start]);
  for (let i = 0; i < MAX_HOPS; i++) {
    if (hasAtsId(cur)) return cur === start ? undefined : cur;
    let r: { status: number; location: string | null };
    try {
      await wait(new URL(cur).hostname);
      r = await hop(cur);
    } catch {
      return cur === start ? undefined : cur;
    }
    if (r.status < 300 || r.status >= 400 || !r.location) return cur === start ? undefined : cur;
    let next: string;
    try {
      next = new URL(r.location, cur).toString();
    } catch {
      return cur === start ? undefined : cur;
    }
    if (WALL.test(new URL(next).pathname + new URL(next).search) || seen.has(next)) return cur === start ? undefined : cur;
    seen.add(next);
    cur = next;
  }
  return cur === start ? undefined : cur;
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
  const pending = new Map<string, Promise<string | undefined>>();
  const out = await pool([...rows], 4, async (r) => {
    const u = r.url;
    if (!u || !/^https?:/i.test(u) || hasAtsId(u)) return r;
    const cached = cache[u];
    if (cached) return { ...r, url: cached };
    let p = pending.get(u);
    if (!p) pending.set(u, (p = followRedirects(u, wait)));
    const to = await p;
    if (!to) return r;
    cache[u] = to;
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
    return { ats: kind, titles: jobs.map((j) => j.title), keys };
  } catch {
    return { ats: kind };
  }
}

// What each watched company's official boards list now (Greenhouse, Lever, Ashby: the board API; Workday: the
// full enumeration), to tell a stale list entry from a posting the pipeline missed. Read-only.
export async function watchedBoards(companies: readonly string[]): Promise<Map<string, WatchedBoard[]>> {
  const wl = loadWatchlist();
  const want = new Set(companies.map(normCompany));
  const out = new Map<string, WatchedBoard[]>();
  const add = (c: string, b: WatchedBoard) => out.set(normCompany(c), [...(out.get(normCompany(c)) ?? []), b]);
  const jobs: { kind: BoardKind; b: { board: string; company: string } }[] = [];
  for (const kind of ["greenhouse", "lever", "ashby"] as const) for (const b of wl[kind]) if (want.has(normCompany(b.company))) jobs.push({ kind, b });
  await pool(jobs, 4, async ({ kind, b }) => add(b.company, await readBoard(kind, b.board)));
  await pool(wl.workday.filter((w) => want.has(normCompany(w.company))), 2, async (w) => add(w.company, await enumerateWorkday(w.site)));
  return out;
}
