import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import type { Channel, Sighting, SizeBand } from "../domain/job.ts";
import { ROLE } from "../discover/triage.ts";
import { parseAshby, parseGreenhouse, parseHnComment, parseLever, parseMarkdownJobTable, parseSimplifyListings, parseWorkdayDetail, type HnComment, type WorkdayDetail } from "../discover/parse.ts";
import { getJson, getText, pool, postJson } from "./http.ts";

const Board = z.object({ board: z.string(), company: z.string(), size: z.enum(["medium_large", "unknown"]).default("unknown"), ai: z.boolean().default(false) });
export const Watchlist = z.object({
  greenhouse: z.array(Board).default([]),
  lever: z.array(Board).default([]),
  ashby: z.array(Board).default([]),
  workdayQueries: z.array(z.string()).default(["new grad", "machine learning"]),
  workday: z.array(z.object({ site: z.url(), company: z.string(), size: z.enum(["medium_large", "unknown"]).default("unknown") })).default([]),
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

interface WorkdayList { total?: number; jobPostings?: { title?: string; externalPath?: string }[] }

// Workday has no list-everything API, so each site is searched with bounded
// queries; only titles that look like AI/ML roles get their detail fetched.
export async function fetchWorkday(w: Watchlist["workday"][number], queries: string[], seenAt: string, perQuery = 60): Promise<Fetched> {
  const u = new URL(w.site);
  const tenant = u.hostname.split(".")[0]!;
  const api = `https://${u.hostname}/wday/cxs/${tenant}${u.pathname.replace(/\/$/, "")}`;
  const base = { name: w.company, channel: "official_workday" as Channel, url: w.site };
  try {
    const paths = new Map<string, string>();
    let listed = 0;
    for (const q of queries) {
      for (let offset = 0; offset < perQuery; offset += 20) {
        const page = await postJson<WorkdayList>(`${api}/jobs`, { appliedFacets: {}, limit: 20, offset, searchText: q }, 60000);
        for (const p of page.jobPostings ?? []) {
          if (!p.externalPath) continue;
          listed++;
          if (ROLE.test(p.title ?? "")) paths.set(p.externalPath, p.title ?? "");
        }
        if (offset + 20 >= (page.total ?? 0)) break;
      }
    }
    const details = await pool([...paths.keys()], 4, async (path) => {
      try {
        return parseWorkdayDetail(await getJson<WorkdayDetail>(api + path, 60000), w.site, path, w.company, seenAt);
      } catch {
        return undefined;
      }
    });
    const s = details.filter((d): d is Sighting => Boolean(d));
    return {
      sightings: s,
      outcome: { ...base, ok: true, count: s.length, size: w.size, note: `${queries.length} searches, ${listed} results, ${paths.size} AI/ML titles, ${s.length} details read` },
    };
  } catch (e) {
    return fail(base, e);
  }
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
