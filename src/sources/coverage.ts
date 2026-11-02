// Fetching for `jh coverage`: public lists the pipeline does not use, plus (read-only) the official
// boards of watched companies, to tell a stale list entry from a posting the pipeline missed.
// Never opens an application form: a short link is only followed one hop for its Location header.
import { readFileSync } from "node:fs";
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

// A list's own redirector (go.vansh.nyc/..) points at the employer's ATS page. Only the Location header is
// read, never the page it points to, so the posting can be matched by its JobKey.
export async function resolveShortLinks(rows: readonly SampleRow[]): Promise<SampleRow[]> {
  return pool([...rows], 8, async (r) => {
    if (!r.url || new URL(r.url).hostname !== "go.vansh.nyc") return r;
    try {
      const res = await fetch(r.url, { redirect: "manual", signal: AbortSignal.timeout(15000), headers: { "user-agent": "jobhunt-agent/2 (personal job search; read-only)" } });
      const to = res.headers.get("location");
      return to ? { ...r, url: new URL(to, r.url).toString() } : r;
    } catch {
      return r;
    }
  });
}

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
