// Fetching for `jh coverage`: public lists the pipeline does not use, plus (read-only) the official
// boards of watched companies, to tell a stale list entry from a posting the pipeline missed.
// Never opens an application form: a short link is only followed one hop for its Location header.
import { readFileSync } from "node:fs";
import { normCompany, notIndependent, parseListTable, urlsIn, type SampleRow, type WatchedBoard } from "../discover/coverage.ts";
import { fetchBoard, loadWatchlist, type BoardKind } from "./fetch.ts";
import { getText, pool } from "./http.ts";

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

// The titles each watched company's official board lists now, for companies on a Greenhouse, Lever or Ashby
// board; Workday boards are only searched by keyword, so their absence is not checkable cheaply.
export async function watchedBoards(companies: readonly string[]): Promise<Map<string, WatchedBoard[]>> {
  const wl = loadWatchlist();
  const want = new Set(companies.map(normCompany));
  const out = new Map<string, WatchedBoard[]>();
  const add = (c: string, b: WatchedBoard) => out.set(normCompany(c), [...(out.get(normCompany(c)) ?? []), b]);
  const jobs: { kind: BoardKind; b: { board: string; company: string } }[] = [];
  for (const kind of ["greenhouse", "lever", "ashby"] as const) for (const b of wl[kind]) if (want.has(normCompany(b.company))) jobs.push({ kind, b });
  for (const w of wl.workday) if (want.has(normCompany(w.company))) add(w.company, { ats: "workday" });
  const seenAt = new Date().toISOString();
  await pool(jobs, 4, async ({ kind, b }) => {
    const f = await fetchBoard(kind, b, seenAt);
    add(b.company, { ats: kind, titles: f.outcome.ok ? f.sightings.map((s) => s.title) : undefined });
  });
  return out;
}
