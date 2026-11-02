import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { atlassianInUS, parseAtlassian, parseIbm, parseJibe, type AtlassianRow, type IbmHit, type JibeJob } from "../src/discover/parse.ts";
import { jobKey } from "../src/discover/identity.ts";
import { OFFICIAL_CHANNELS } from "../src/domain/job.ts";
import { SOURCE_REGISTRY } from "../src/discover/sources.ts";
import { fetchAtlassian, fetchIbm, fetchJibe, loadWatchlist, Watchlist } from "../src/sources/fetch.ts";

const fx = <T>(name: string): T => JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8")) as T;
const SEEN = "2026-11-02T12:00:00.000Z";
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const stubFetch = (reply: (url: string, init?: RequestInit) => Response) => vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => reply(String(url), init)));
afterEach(() => vi.unstubAllGlobals());

describe("identity of the new own-site postings", () => {
  it("keys an iCIMS posting by portal host and requisition id, whatever the slug or suffix", () => {
    const k = "icims:campus-americas.icims.com:26074";
    expect(jobKey("https://campus-americas.icims.com/jobs/26074/ai-researcher-%28phd%29%2c-2027-graduate-canada/job")).toBe(k);
    expect(jobKey("https://campus-americas.icims.com/jobs/26074/other-slug/job?mode=apply")).toBe(k);
    expect(jobKey("https://campus-americas.icims.com/jobs/26074/login")).toBe(k);
    // the same number on another portal is another posting
    expect(jobKey("https://careers-sri.icims.com/jobs/26074/x/job")).toBe("icims:careers-sri.icims.com:26074");
  });
  it("does not key an iCIMS search page or a non-numeric path as a posting", () => {
    expect(jobKey("https://careers-sri.icims.com/jobs/search?ss=1")).toMatch(/^url:/);
    expect(jobKey("https://careers-sri.icims.com/jobs/abc/x/job")).toMatch(/^url:/);
  });
  it("keys a Jibe posting by host and id, with or without the language query", () => {
    expect(jobKey("https://careers.amd.com/careers-home/jobs/87057")).toBe("jibe:careers.amd.com:87057");
    expect(jobKey("https://careers.amd.com/careers-home/jobs/87057?lang=en-us")).toBe("jibe:careers.amd.com:87057");
    expect(jobKey("https://careers.amd.com/careers-home/jobs/not-a-number")).toMatch(/^url:/);
  });
  it("keys an IBM posting by jobId, with or without the locale segment", () => {
    expect(jobKey("https://careers.ibm.com/careers/JobDetail?jobId=138632")).toBe("ibm:138632");
    expect(jobKey("https://careers.ibm.com/en_US/careers/JobDetail?jobId=138632")).toBe("ibm:138632");
    expect(jobKey("https://careers.ibm.com/careers/JobDetail?jobId=abc")).toMatch(/^url:/);
  });
});

describe("Atlassian listings (saved response, 2026-11-02)", () => {
  const rows = fx<AtlassianRow[]>("atlassian-listings.json");
  it("turns a US row into an official sighting keyed by the iCIMS requisition, dated only as updated", () => {
    const s = parseAtlassian(rows, SEEN).find((x) => x.title.startsWith("AI Researcher"))!;
    expect(s.channel).toBe("official_atlassian");
    expect(s.official).toBe(true);
    expect(s.company).toBe("Atlassian");
    expect(s.url).toBe("https://campus-americas.icims.com/jobs/26246/ai-researcher-%28phd%29%2c-2027-graduate-u.s./job");
    expect(s.key).toBe("icims:campus-americas.icims.com:26246");
    expect(s.dateKind).toBe("updated");
    expect(s.date).toMatch(/^2026-\d\d-\d\dT\d\d:\d\d:00\.000Z$/);
    expect(s.description).toContain("Category:");
  });
  it("converts 12-hour clock times (12 AM is hour 0, 12 PM is noon)", () => {
    const row = (t: string): AtlassianRow => ({ title: "ML Engineer", locations: ["Austin - United States"], portalJobPost: { portalUrl: "https://x.icims.com/jobs/1/a/job", updatedDate: t } });
    expect(parseAtlassian([row("2026-10-30 12:05 AM")], SEEN)[0]!.date).toBe("2026-10-30T00:05:00.000Z");
    expect(parseAtlassian([row("2026-10-30 12:05 PM")], SEEN)[0]!.date).toBe("2026-10-30T12:05:00.000Z");
    expect(parseAtlassian([row("2026-10-30 03:15 PM")], SEEN)[0]!.date).toBe("2026-10-30T15:15:00.000Z");
  });
  it("gives no date, not a made-up one, when the update time is missing or unreadable", () => {
    const base = { title: "ML Engineer", locations: ["Austin - United States"] };
    for (const portalJobPost of [{ portalUrl: "https://x.icims.com/jobs/1/a/job" }, { portalUrl: "https://x.icims.com/jobs/1/a/job", updatedDate: "yesterday" }]) {
      const s = parseAtlassian([{ ...base, portalJobPost }], SEEN)[0]!;
      expect(s.date).toBe("");
      expect(s.dateKind).toBe("none");
    }
  });
  it("falls back to applyUrl without ?mode=apply, and skips rows with no title or no iCIMS posting link", () => {
    const s = parseAtlassian([{ title: "ML Engineer", applyUrl: "https://x.icims.com/jobs/7/ml/job?mode=apply" }], SEEN);
    expect(s.map((x) => x.url)).toEqual(["https://x.icims.com/jobs/7/ml/job"]);
    expect(parseAtlassian([{ title: "", applyUrl: "https://x.icims.com/jobs/7/ml/job" }, { title: "ML", applyUrl: "https://example.com/x" }, { title: "ML" }], SEEN)).toEqual([]);
  });
  it("tolerates a non-list answer", () => {
    expect(parseAtlassian(undefined, SEEN)).toEqual([]);
    expect(parseAtlassian({} as unknown as AtlassianRow[], SEEN)).toEqual([]);
  });
  it("tells US rows from the rest: a US location or a U.S. title, not Australia, not bare Remote", () => {
    const by = Object.fromEntries(rows.map((r) => [r.title, atlassianInUS(r)]));
    expect(by["AI Researcher (PhD), 2027 Graduate U.S."]).toBe(true);
    expect(by["Backend Software Engineer"]).toBe(false);
    expect(by["Software Engineer, 2027 Graduate Canada"]).toBe(false);
    expect(atlassianInUS({ title: "Data Engineer, 2027 Graduate U.S", locations: [] })).toBe(true);
    expect(atlassianInUS({ title: "X", locations: ["Remote - Remote"] })).toBe(false);
    expect(atlassianInUS({ title: "Focus lead", locations: ["Sydney - Australia"] })).toBe(false);
  });
  it("fetches the whole list once, keeps US AI/ML titles and reports counts", async () => {
    stubFetch(() => answer(rows));
    const f = await fetchAtlassian(SEEN);
    expect(f.outcome).toMatchObject({ ok: true, channel: "official_atlassian", listed: 4, count: 1 });
    expect(f.sightings.map((s) => s.title)).toEqual(["AI Researcher (PhD), 2027 Graduate U.S."]);
  });
  it("fails the outcome, with no sightings, on an error status or a non-list answer", async () => {
    stubFetch(() => answer({}, 404));
    expect(await fetchAtlassian(SEEN)).toMatchObject({ sightings: [], outcome: { ok: false, count: 0 } });
    stubFetch(() => answer({ error: "x" }));
    expect(await fetchAtlassian(SEEN)).toMatchObject({ sightings: [], outcome: { ok: false } });
  });
});

describe("iCIMS Jibe career sites (saved AMD response, 2026-11-02)", () => {
  const body = fx<{ totalCount: number; jobs: JibeJob[] }>("jibe-amd.json");
  it("turns a job into an official sighting on the career host with its posted_date", () => {
    const s = parseJibe(body, "careers.amd.com", "AMD", SEEN)[0]!;
    expect(s.channel).toBe("official_jibe");
    expect(s.official).toBe(true);
    expect(s.url).toBe("https://careers.amd.com/careers-home/jobs/87704");
    expect(s.key).toBe("jibe:careers.amd.com:87704");
    expect(s.date).toBe("2026-07-02T02:32:00.000Z");
    expect(s.dateKind).toBe("published");
    expect(s.location).toBe("Santa Clara, California");
    expect(s.description).not.toMatch(/<[a-z]+[ >]/);
  });
  it("gives no date when posted_date is missing or garbage, and skips jobs without an id or title", () => {
    const d = { slug: "5", title: "ML Engineer" };
    expect(parseJibe({ jobs: [{ data: d }] }, "careers.amd.com", "AMD", SEEN)[0]).toMatchObject({ date: "", dateKind: "none" });
    expect(parseJibe({ jobs: [{ data: { ...d, posted_date: "soon" } }] }, "careers.amd.com", "AMD", SEEN)[0]!.dateKind).toBe("none");
    expect(parseJibe({ jobs: [{ data: { title: "ML" } }, { data: { slug: "x1", title: "ML" } }, { data: { slug: "5" } }, {}] }, "careers.amd.com", "AMD", SEEN)).toEqual([]);
    expect(parseJibe({ jobs: [{ data: { req_id: "9", title: "ML" } }] }, "h.com", "H", SEEN)[0]!.key).toBe("jibe:h.com:9");
    expect(parseJibe(undefined, "h.com", "H", SEEN)).toEqual([]);
  });
  const W = Watchlist.parse({ jibe: [{ host: "careers.amd.com", company: "AMD", size: "medium_large" }] }).jibe[0]!;
  const job = (i: number, title: string, cc = "US"): JibeJob => ({ data: { slug: String(1000 + i), title, country_code: cc, posted_date: "2026-10-30T10:00:00+0000" } });
  it("walks pages until the list is exhausted, asks for US only, and keeps only in-scope titles", async () => {
    const urls: string[] = [];
    const all = Array.from({ length: 230 }, (_, i) => job(i, i % 50 === 0 ? "Machine Learning Engineer, New Grad" : "Sales Account Manager"));
    stubFetch((u) => {
      urls.push(u);
      const page = Number(new URL(u).searchParams.get("page"));
      return answer({ totalCount: 230, jobs: all.slice((page - 1) * 100, page * 100) });
    });
    const f = await fetchJibe(W, SEEN);
    expect(urls).toHaveLength(3);
    expect(urls.every((u) => new URL(u).searchParams.get("country") === "United States" && u.startsWith("https://careers.amd.com/api/jobs?"))).toBe(true);
    expect(f.outcome).toMatchObject({ ok: true, listed: 230, pages: 3, capHit: false, count: 5 });
    expect(f.sightings.every((s) => s.title.startsWith("Machine Learning"))).toBe(true);
  });
  it("says recall is bounded when the page cap stops the walk", async () => {
    stubFetch(() => answer({ totalCount: 900, jobs: Array.from({ length: 100 }, (_, i) => job(i, "Data Scientist")) }));
    const f = await fetchJibe(W, SEEN, 2);
    expect(f.outcome).toMatchObject({ ok: true, pages: 2, listed: 200, capHit: true });
  });
  it("drops a non-US row that slipped through and tolerates an empty first page", async () => {
    stubFetch(() => answer({ totalCount: 2, jobs: [job(1, "ML Engineer", "SG"), job(2, "ML Engineer")] }));
    expect((await fetchJibe(W, SEEN)).sightings).toHaveLength(1);
    stubFetch(() => answer({ totalCount: 0, jobs: [] }));
    expect(await fetchJibe(W, SEEN)).toMatchObject({ sightings: [], outcome: { ok: true, count: 0, capHit: false } });
  });
  it("fails the outcome, with no sightings, on an error status or an answer without a job list", async () => {
    stubFetch(() => answer({}, 404));
    expect(await fetchJibe(W, SEEN)).toMatchObject({ sightings: [], outcome: { ok: false } });
    stubFetch(() => answer({ message: "no" }));
    expect(await fetchJibe(W, SEEN)).toMatchObject({ sightings: [], outcome: { ok: false } });
  });
});

describe("IBM careers search (saved response, 2026-11-02)", () => {
  const hits = fx<{ hits: { hits: IbmHit[] } }>("ibm-search.json").hits.hits;
  it("turns a hit into an official sighting keyed by jobId, dated by dcdate", () => {
    const s = parseIbm(hits, SEEN).find((x) => x.title === "AI Software Engineer Intern 2027")!;
    expect(s.channel).toBe("official_ibm");
    expect(s.official).toBe(true);
    expect(s.company).toBe("IBM");
    expect(s.key).toMatch(/^ibm:\d+$/);
    expect(s.url).toBe(`https://careers.ibm.com/careers/JobDetail?jobId=${s.key.slice(4)}`);
    expect(s.date).toBe("2026-10-30T00:00:00.000Z");
    expect(s.dateKind).toBe("published");
    expect(s.location).toContain("United States");
  });
  it("gives no date for a missing or malformed dcdate, and skips hits without a title or jobId", () => {
    const src = { title: "ML Engineer", url: "https://careers.ibm.com/careers/JobDetail?jobId=7" };
    expect(parseIbm([{ _source: src }], SEEN)[0]).toMatchObject({ date: "", dateKind: "none" });
    expect(parseIbm([{ _source: { ...src, dcdate: "10/30/2026" } }], SEEN)[0]!.dateKind).toBe("none");
    expect(parseIbm([{ _source: { ...src, title: " " } }, { _source: { ...src, url: "https://careers.ibm.com/x" } }, {}], SEEN)).toEqual([]);
    expect(parseIbm(undefined, SEEN)).toEqual([]);
  });
  const hit = (i: number, title: string): IbmHit => ({ _source: { title, url: `https://careers.ibm.com/careers/JobDetail?jobId=${100 + i}`, dcdate: "2026-10-30" } });
  it("posts the US filter, pages by offset until the total, and keeps in-scope titles", async () => {
    const froms: number[] = [];
    const all = Array.from({ length: 250 }, (_, i) => hit(i, i % 100 === 0 ? "Machine Learning Engineer - Entry Level" : "Client Partner"));
    stubFetch((_u, init) => {
      const req = JSON.parse(String(init?.body));
      froms.push(req.from);
      expect(JSON.stringify(req.query)).toContain("United States");
      return answer({ hits: { total: { value: 250 }, hits: all.slice(req.from, req.from + req.size) } });
    });
    const f = await fetchIbm(SEEN);
    expect(froms).toEqual([0, 100, 200]);
    expect(f.outcome).toMatchObject({ ok: true, listed: 250, pages: 3, capHit: false, count: 3 });
  });
  it("says recall is bounded at the page cap, and fails on an error or a missing hit list", async () => {
    stubFetch(() => answer({ hits: { total: { value: 5000 }, hits: Array.from({ length: 100 }, (_, i) => hit(i, "Data Scientist")) } }));
    expect((await fetchIbm(SEEN, "medium_large", 2)).outcome).toMatchObject({ ok: true, pages: 2, capHit: true });
    stubFetch(() => answer({}, 404));
    expect(await fetchIbm(SEEN)).toMatchObject({ sightings: [], outcome: { ok: false } });
    stubFetch(() => answer({ errors: [] }));
    expect(await fetchIbm(SEEN)).toMatchObject({ sightings: [], outcome: { ok: false } });
  });
});

describe("registry and watchlist wiring", () => {
  it("lists the new channels as official and the registry rows as live", () => {
    for (const c of ["official_atlassian", "official_jibe", "official_ibm"] as const) {
      expect(OFFICIAL_CHANNELS).toContain(c);
      expect(SOURCE_REGISTRY.find((r) => r.id === c)?.status).toBe("live");
    }
  });
  it("watches Atlassian, AMD and IBM, and no longer lists them as pending", () => {
    const wl = loadWatchlist();
    expect(wl.atlassian).toBeDefined();
    expect(wl.ibm).toBeDefined();
    expect(wl.jibe.map((j) => j.host)).toContain("careers.amd.com");
    const pending = wl.pending.map((p) => p.company);
    for (const c of ["Atlassian", "IBM", "AMD"]) expect(pending).not.toContain(c);
  });
});
