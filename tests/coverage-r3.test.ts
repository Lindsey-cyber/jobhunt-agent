import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bandOf, bandOfCompany, causeOf, indexCatalog, isAggregator, liveness, makeCanon, match, normCompany, report, requisitionOf, resampleRows, sampleOf, summarize, watchBands,
  type Judged, type SampleRow, type WatchedBoard,
} from "../src/discover/coverage.ts";
import { renderGates, stageGates } from "../src/discover/gates.ts";
import type { Job, JobKey } from "../src/domain/job.ts";
import { enumerateEightfold, EIGHTFOLD_PAGE_CAP, loadSizeSources, resolveRequisitions } from "../src/sources/coverage.ts";
import { loadWatchlist, Watchlist } from "../src/sources/fetch.ts";
import { coverageProblem } from "../src/store/coverage.ts";

const job = (o: Partial<Omit<Job, "key">> & { key: string; company: string; title: string }): Job =>
  ({ location: "Remote, US", url: `https://x.test/${o.key}`, official: false, publishedAt: "", description: "", sources: [], firstSeen: "", lastSeen: "", triage: { verdict: "match", rule: "role.match", reason: "" }, hints: {}, size: "unknown", ...o, key: o.key as JobKey }) as Job;
const row = (company: string, title: string, o: Partial<SampleRow> = {}): SampleRow => ({ company, title, location: "Austin, TX", date: "Nov 01", list: "L", ...o });
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const stubFetch = (reply: (url: string) => Response) => vi.stubGlobal("fetch", vi.fn(async (url: string) => reply(String(url))));
afterEach(() => vi.unstubAllGlobals());

describe("company aliases", () => {
  const canon = makeCanon({ GDIT: "General Dynamics Information Technology", Omnicom: "Omnicom Group" });
  it("makes both names of one employer equal, whatever the spelling or legal suffix", () => {
    expect(canon("GDIT")).toBe(canon("General Dynamics Information Technology, Inc."));
    expect(canon("Omnicom Group")).toBe(canon("omnicom"));
  });
  it("leaves every other name as normCompany has it, and does not merge near names", () => {
    expect(canon("General Dynamics Mission Systems")).toBe(normCompany("General Dynamics Mission Systems"));
    expect(canon("Omnicom Health")).not.toBe(canon("Omnicom"));
  });
  it("is plain normCompany with no table", () => expect(makeCanon()("Acme, LLC")).toBe(normCompany("Acme")));
  it("ignores an alias of a name to itself", () => expect(makeCanon({ Acme: "Acme Inc" })("Acme")).toBe("acme"));
  it("refuses a chain, a loop and an empty name", () => {
    expect(() => makeCanon({ A: "B", B: "C" })).toThrow(/chain/);
    expect(() => makeCanon({ A: "B", B: "A" })).toThrow(/chain/);
    expect(() => makeCanon({ A: "..." })).toThrow(/nothing/);
  });
  it("the committed watchlist table parses, has no chain, and joins the four known pairs", () => {
    const c = makeCanon(loadWatchlist().aliases);
    expect(c("GDIT")).toBe(c("General Dynamics Information Technology"));
    expect(c("Omnicom")).toBe(c("Omnicom Group"));
    expect(c("Booz Allen")).toBe(c("Booz Allen Hamilton"));
  });
  it("coverage matching follows it: a GDIT catalog row answers a long-name list row", () => {
    const idx = indexCatalog([job({ key: "workday:gdit:rq230485", company: "GDIT", title: "Data Scientist" }), job({ key: "workday:paypal:r1", company: "PayPal", title: "Data Scientist - Payments Risk" })], canon);
    expect(match(row("General Dynamics Information Technology", "Data Scientist"), idx)?.job.key).toBe("workday:gdit:rq230485");
    expect(match(row("PayPal", "Data Scientist - Payments Risk"), idx)?.job.key).toBe("workday:paypal:r1");
    expect(match(row("Omnicom", "Data Scientist"), idx)).toBeUndefined();
  });
  it("a subsidiary is not its parent: a Venmo row does NOT match a PayPal posting, with or without the table", () => {
    const paypal = job({ key: "workday:paypal:r1", company: "PayPal", title: "Data Scientist - Payments Risk" });
    expect(match(row("Venmo", "Data Scientist - Payments Risk"), indexCatalog([paypal], canon))).toBeUndefined();
    expect(match(row("Venmo", "Data Scientist - Payments Risk"), indexCatalog([paypal]))).toBeUndefined();
    expect(makeCanon(loadWatchlist().aliases)("Venmo")).not.toBe(makeCanon(loadWatchlist().aliases)("PayPal"));
  });
  it("without the table the same rows miss (the table is what fixes it)", () => {
    const idx = indexCatalog([job({ key: "workday:gdit:rq230485", company: "GDIT", title: "Data Scientist" })]);
    expect(match(row("General Dynamics Information Technology", "Data Scientist"), idx)).toBeUndefined();
  });
  it("aggregator check and sample de-duplication use it", () => {
    expect(isAggregator("GDIT", ["General Dynamics Information Technology"], canon)).toBe(true);
    expect(isAggregator("GDIT", ["General Dynamics Information Technology"])).toBe(false);
    expect(sampleOf([row("GDIT", "Data Scientist"), row("General Dynamics Information Technology", "Data Scientist")], 10, canon)).toHaveLength(1);
  });
});

describe("size bands", () => {
  it.each([
    [undefined, "unknown"], [Number.NaN, "unknown"], [-1, "unknown"], [0, "small"], [19, "small"], [20, "mid"], [199, "mid"], [200, "large"], [6492, "large"],
  ] as const)("%s filings is %s", (n, b) => expect(bandOf(n)).toBe(b));
  const canon = makeCanon({ GDIT: "General Dynamics Information Technology" });
  const watch = watchBands([{ company: "General Dynamics Information Technology", band: "large" }, { company: "Acme", band: "small" }, { company: "Acme Inc", band: "mid" }, { company: "Blank" }], canon);
  const filings = (c: string) => ({ globex: 25, paypal: 9999, blank: 300 })[normCompany(c)];
  it("takes the largest band of a company that has several boards", () => expect(watch.get("acme")).toBe("mid"));
  it("uses the watchlist band first, an alias included", () => expect(bandOfCompany("GDIT", canon, { watch, filings: () => 1 })).toBe("large"));
  it("falls back to filings when the watchlist band is unknown or absent", () => {
    expect(bandOfCompany("Blank", canon, { watch, filings })).toBe("large");
    expect(bandOfCompany("Globex", canon, { watch, filings })).toBe("mid");
  });
  it("is unknown with neither", () => expect(bandOfCompany("Nobody", canon, { watch, filings })).toBe("unknown"));

  it("loadSizeSources reads the watchlist band, then own counts, then the cache, and ignores counts from another year", () => {
    const dir = mkdtempSync(join(tmpdir(), "jh-size-"));
    mkdirSync(join(dir, "h1b"));
    writeFileSync(join(dir, "h1b", "watchlist-counts.json"), JSON.stringify({ globex: { filings: 250, since: 2023 }, oldyear: { filings: 500, since: 2020 } }));
    writeFileSync(join(dir, "h1b", "sponsors.json"), JSON.stringify({ initech: { company: "Initech", filings: 30 }, oldyear: { company: "Oldyear", filings: 5 } }));
    const wl = Watchlist.parse({ greenhouse: [{ board: "a", company: "Acme", band: "mid" }], pending: [{ company: "Pend", band: "large" }] });
    const s = loadSizeSources(dir, 2023, wl);
    expect(s.watch.get("acme")).toBe("mid");
    expect(s.watch.get("pend")).toBe("large");
    expect(s.filings("Globex Inc")).toBe(250);
    expect(s.filings("Initech")).toBe(30);
    expect(s.filings("Oldyear")).toBe(5);
    expect(s.filings("Nobody")).toBeUndefined();
  });
  it("loadSizeSources survives missing files", () => expect(loadSizeSources(mkdtempSync(join(tmpdir(), "jh-size-")), 2023, Watchlist.parse({})).filings("X")).toBeUndefined());

  const found = (verdict: "match" | "reject") => ({ job: job({ key: "greenhouse:1", company: "A", title: "T", triage: { verdict, rule: "r", reason: "" } }), how: "key" as const });
  const j = (band: Judged["band"], hit: boolean | "reject", cause?: string): Judged => ({ row: row("A", "T"), found: hit ? found(hit === "reject" ? "reject" : "match") : undefined, cause, band });
  it("report splits the real postings by band, sums to n, leaves stale ones out, defaults to unknown", () => {
    const r = report("2026-11-02", ["s"], [j("large", true), j("large", false, "company not on watchlist"), j("mid", "reject", "filtered by triage rule x"), j("small", false, "stale list entry (gone)"), j(undefined, true)]);
    expect(r.n).toBe(4);
    expect(r.bands).toEqual({ large: { n: 2, inCatalog: 1, inCatalogNotRejected: 1 }, mid: { n: 1, inCatalog: 1, inCatalogNotRejected: 0 }, small: { n: 0, inCatalog: 0, inCatalogNotRejected: 0 }, unknown: { n: 1, inCatalog: 1, inCatalogNotRejected: 1 } });
    expect(coverageProblem(r)).toBeUndefined();
    expect(summarize(r)).toContain("large 1/2, mid 1/1, small 0/0, unknown 1/1");
    expect(summarize(r)).toContain("large + mid): 2/3 = 66.7%");
  });
});

describe("gate 1a counts large and mid employers only", () => {
  const band = (n: number, inCatalog: number) => ({ n, inCatalog, inCatalogNotRejected: inCatalog });
  const cov = (large: [number, number], mid: [number, number], small: [number, number] = [0, 0], unknown: [number, number] = [0, 0]) => {
    const bands = { large: band(...large), mid: band(...mid), small: band(...small), unknown: band(...unknown) };
    const all = Object.values(bands);
    return { date: "2026-11-02", n: all.reduce((a, b) => a + b.n, 0), inCatalog: all.reduce((a, b) => a + b.inCatalog, 0), inCatalogNotRejected: all.reduce((a, b) => a + b.inCatalogNotRejected, 0), bands };
  };
  const g1a = (coverage: ReturnType<typeof cov> | { date: string; n: number; inCatalog: number; inCatalogNotRejected: number }) =>
    stageGates({ coverage, registry: [{ status: "live" }], today: "2026-11-02", matches: [] })["1a"];
  const check = (g: ReturnType<typeof g1a>, i: number) => g.checks[i]!;

  it("95.0% of large + mid passes, 94.9% does not (n=100 and n=99+... boundary at 19/20)", () => {
    expect(check(g1a(cov([60, 57], [40, 38])), 2).pass).toBe(true); // 95/100
    expect(check(g1a(cov([60, 57], [40, 37])), 2).pass).toBe(false); // 94/100
    expect(check(g1a(cov([30, 29], [20, 18])), 2).pass).toBe(false); // 47/50 = 94%
    expect(check(g1a(cov([30, 29], [20, 19])), 2).pass).toBe(true); // 48/50 = 96%
  });
  it("n counts large + mid: 49 fails, 50 passes, however many small rows there are", () => {
    expect(check(g1a(cov([25, 25], [24, 24], [100, 100])), 1).pass).toBe(false);
    expect(check(g1a(cov([25, 25], [25, 25], [0, 0])), 1).pass).toBe(true);
    expect(check(g1a(cov([25, 25], [24, 24], [100, 100], [100, 100])), 1).value).toBe("n=49");
  });
  it("small and unknown misses never fail the gate, and are reported on the page", () => {
    const g = g1a(cov([30, 30], [30, 30], [10, 0], [10, 0]));
    expect(g.checks.slice(0, 3).every((c) => c.pass)).toBe(true);
    expect(g.notes).toEqual(["小型雇主：0/10 在库（只报告，不设门）", "规模未知雇主：0/10 在库（只报告，不设门）"]);
    expect(renderGates({ "1a": g, "1b": g, "1c": g }).join("\n")).toContain("ℹ 小型雇主：0/10");
  });
  it("large + mid misses fail it even when the all-row share is high", () => {
    const c = cov([30, 25], [30, 30], [200, 200]);
    expect(c.inCatalog / c.n).toBeGreaterThan(0.95);
    expect(check(g1a(c), 2).pass).toBe(false);
  });
  it("zero large + mid rows is n=0, not a pass", () => {
    const g = g1a(cov([0, 0], [0, 0], [60, 60]));
    expect(check(g, 1).pass).toBe(false);
    expect(check(g, 2)).toMatchObject({ pass: false, value: "n=0" });
  });
  it("an older file without bands is judged on all its rows, as before, with no notes", () => {
    const g = g1a({ date: "2026-11-02", n: 50, inCatalog: 48, inCatalogNotRejected: 40 });
    expect(check(g, 2).pass).toBe(true);
    expect(g.notes).toBeUndefined();
  });
});

describe("coverage file validation of bands", () => {
  const b = (n: number, i = n, r = i) => ({ n, inCatalog: i, inCatalogNotRejected: r });
  const ok = { date: "2026-11-02", n: 10, inCatalog: 8, inCatalogNotRejected: 6, bands: { large: b(4, 4, 3), mid: b(3, 2, 1), small: b(2, 1, 1), unknown: b(1, 1, 1) } };
  it("accepts a consistent split", () => expect(coverageProblem(ok)).toBeUndefined());
  it.each([
    ["not an object", { ...ok, bands: 3 }],
    ["an array", { ...ok, bands: [] }],
    ["a missing band", { ...ok, bands: { large: b(10, 8, 6) } }],
    ["a fractional count", { ...ok, bands: { ...ok.bands, mid: b(3.5, 2, 1) } }],
    ["a negative count", { ...ok, bands: { ...ok.bands, mid: b(3, 2, -1) } }],
    ["inCatalog above n", { ...ok, bands: { ...ok.bands, mid: b(3, 4, 1) } }],
    ["rejected-free above inCatalog", { ...ok, bands: { ...ok.bands, mid: b(3, 2, 3) } }],
    ["n not adding up", { ...ok, n: 11 }],
    ["inCatalog not adding up", { ...ok, inCatalog: 9 }],
    ["inCatalogNotRejected not adding up", { ...ok, inCatalogNotRejected: 7 }],
  ])("rejects %s", (_n, bad) => expect(coverageProblem(bad)).toBeDefined());
});

describe("resample toward the target", () => {
  const pool = Array.from({ length: 10 }, (_, k) => row(`Co${String(k).padStart(2, "0")}`, "ML Engineer"));
  it("asks for nothing when n already meets the target", () => expect(resampleRows(pool, [], 100, 100)).toEqual([]));
  it("asks for the shortfall, skipping rows already taken (aliased names included)", () => {
    const canon = makeCanon({ Zed: "Co00" });
    const more = resampleRows(pool, [row("Zed", "ML Engineer")], 98, 100, canon);
    expect(more).toHaveLength(2);
    expect(more.map((r) => r.company)).not.toContain("Co00");
  });
  it("gives fewer when the lists run out", () => expect(resampleRows(pool, pool.slice(0, 8), 0, 100)).toHaveLength(2));
  it("is deterministic", () => expect(resampleRows(pool, [], 5, 8)).toEqual(resampleRows(pool, [], 5, 8)));
});

describe("watched postings the checker used to call not fetched", () => {
  it("NVIDIA: the career site's own position id resolves to the Workday requisition and matches it, preferring the match over a same-titled reject", async () => {
    stubFetch((url) => (url.includes("position_id=893397927110") ? answer({ data: { displayJobId: "JR2026576" } }) : answer({}, 404)));
    const [r] = await resolveRequisitions([row("NVIDIA", "Applied Machine Learning Engineer, AI for VLSI Design (Master's)", { url: "https://jobs.nvidia.com/careers/job/893397927110" })], Watchlist.parse({}));
    expect(r!.requisition).toBe("jr2026576");
    const idx = indexCatalog([
      job({ key: "workday:nvidia:jr2025689", company: "NVIDIA", title: "Applied Machine Learning Engineer - AI for VLSI Design", triage: { verdict: "reject", rule: "x", reason: "" } }),
      job({ key: "workday:nvidia:jr2026576", company: "NVIDIA", title: "Applied Machine Learning Engineer, AI for VLSI Design - New College Grad 2026" }),
    ]);
    expect(match(r!, idx)).toMatchObject({ how: "key", job: { key: "workday:nvidia:jr2026576" } });
    // Without the requisition the Eightfold id decides alone and finds nothing.
    expect(match({ ...r!, requisition: undefined }, idx)).toBeUndefined();
  });
  it("a requisition names the posting only under the same company", () => {
    const idx = indexCatalog([job({ key: "workday:other:jr1", company: "Other", title: "T" })]);
    expect(match(row("NVIDIA", "T", { url: "https://jobs.nvidia.com/careers/job/893397927110", requisition: "jr1" }), idx)).toBeUndefined();
  });
  it("requisitionOf reads Workday keys only", () => {
    expect(requisitionOf("workday:nvidia:jr2026584-1")).toBe("jr2026584-1");
    expect(requisitionOf("greenhouse:123")).toBeUndefined();
    expect(requisitionOf("workday:x")).toBeUndefined();
  });
  it("resolveRequisitions leaves a link alone when the site answers nothing, an error, or no id, and asks once per link", async () => {
    const f = vi.fn(async () => answer({ data: {} }));
    vi.stubGlobal("fetch", f);
    const a = row("NVIDIA", "T", { url: "https://jobs.nvidia.com/careers/job/893397927110" });
    const rows = await resolveRequisitions([a, a, row("X", "T", { url: "https://boards.greenhouse.io/x/jobs/1" }), row("Y", "T")], Watchlist.parse({}));
    expect(rows.every((r) => r.requisition === undefined)).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    stubFetch(() => answer({}, 403));
    expect((await resolveRequisitions([a], Watchlist.parse({})))[0]!.requisition).toBeUndefined();
  });
  it("liveness: a requisition on the board proves live; a fully read board without it and without the title proves gone", () => {
    const board: WatchedBoard = { ats: "workday", site: "nvidia/x", titles: ["Other"], keys: ["workday:nvidia:jr2026576"], partial: false };
    const r = row("NVIDIA", "Whatever", { url: "https://jobs.nvidia.com/careers/job/893397927110", requisition: "jr2026576" });
    expect(liveness(r, [board])).toBe("live");
    expect(liveness({ ...r, requisition: "jr1" }, [board])).toBe("not_listed");
    expect(liveness({ ...r, requisition: "jr1" }, [{ ...board, partial: true }])).toBe("unknown");
  });

  // Revionics: the employer's page still carries gh_jid, but its only board is Workday, read in full, and lists no such posting.
  const revionics = row("Revionics", "New Grad: Machine Learning Engineer", { url: "https://revionics.com/about/careers/open-jobs?gh_jid=7172125" });
  const wd = (titles: string[], partial = false): WatchedBoard => ({ ats: "workday", site: "aptos/revionics", titles, keys: titles.map((_, i) => `workday:aptos:jr${i}`), partial });
  it("Revionics: a gh_jid on the employer's domain with no Greenhouse board is never stale: its board is Workday, not the id's", () => {
    expect(liveness(revionics, [wd(["Product Manager", "Account Executive"])])).toBe("unknown");
    expect(liveness(revionics, [wd(["New Grad: Machine Learning Engineer"])])).toBe("live");
    expect(liveness(revionics, [wd(["Product Manager"], true)])).toBe("unknown");
    expect(liveness(revionics, [{ ats: "workday" }])).toBe("unknown");
  });
  it("Revionics: gone from the Workday board is not stale (the link's id is not a Workday id): watched, posting not fetched", () => {
    const idx = indexCatalog([]);
    expect(causeOf(revionics, undefined, idx, [wd(["Product Manager", "Account Executive"])])).toMatch(/^watched company, posting not fetched/);
    expect(causeOf(revionics, undefined, idx, [wd(["Product Manager", "Account Executive"], true)])).toMatch(/^watched company, posting not fetched/);
  });
  it("a gh_jid on the employer's domain with a Greenhouse board read in full and the id absent is stale", () => {
    const gh: WatchedBoard = { ats: "greenhouse", board: "revionics", titles: ["Other"], keys: ["greenhouse:9"] };
    expect(liveness(row("Revionics", "New Grad: Machine Learning Engineer", { url: "https://revionics.com/careers?gh_jid=7172125" }), [gh, wd(["X"])])).toBe("not_listed");
  });
  it("a gh_jid with a Greenhouse board known, or a link on greenhouse.io itself, is still judged on that board", () => {
    const gh: WatchedBoard = { ats: "greenhouse", board: "acme", titles: ["A"], keys: ["greenhouse:1"] };
    expect(liveness(row("Acme", "B", { url: "https://acme.com/careers?gh_jid=2" }), [gh, wd(["C"])])).toBe("not_listed");
    expect(liveness(row("Acme", "B", { url: "https://job-boards.greenhouse.io/acme/jobs/2" }), [wd(["C"])])).toBe("unknown");
  });

  // Eaton: an Eightfold tenant the checker could not read at all.
  const EF = { host: "eaton.eightfold.ai", domain: "eaton.com", api: "pcsx" as const, company: "Eaton", size: "medium_large" as const };
  const positions = (from: number, n: number) => Array.from({ length: n }, (_, k) => ({ id: 687000000000 + from + k, name: `Role ${from + k}` }));
  const board = (total: unknown, extra: (start: number) => Response | undefined = () => undefined) => (url: string) => {
    const start = Number(new URL(url).searchParams.get("start"));
    return extra(start) ?? answer({ data: { count: total, positions: typeof total === "number" ? positions(start, Math.max(0, Math.min(10, total - start))) : positions(start, 10) } });
  };
  it("reads a whole Eightfold board: every id and title, not partial", async () => {
    stubFetch(board(25));
    const b = await enumerateEightfold(EF);
    expect(b).toMatchObject({ ats: "eightfold", partial: false });
    expect(b.keys).toHaveLength(25);
    expect(b.keys![0]).toBe("eightfold:eaton.eightfold.ai:687000000000");
    expect(b.titles![24]).toBe("Role 24");
  });
  it.each([
    ["no count", undefined],
    ["a zero count", 0],
    ["a string count", "25"],
    ["a fractional count", 25.5],
  ])("is partial with %s", async (_n, total) => {
    stubFetch(board(total));
    expect((await enumerateEightfold(EF)).partial).toBe(true);
  });
  it("is partial when a later page fails, or is not a list, or the count is not reached", async () => {
    stubFetch(board(25, (s) => (s === 10 ? answer({}, 400) : undefined)));
    expect((await enumerateEightfold(EF)).partial).toBe(true);
    stubFetch(board(25, (s) => (s === 10 ? answer({ data: { count: 25 } }) : undefined)));
    expect((await enumerateEightfold(EF)).partial).toBe(true);
    stubFetch(board(25, (s) => (s === 20 ? answer({ data: { count: 25, positions: positions(20, 3) } }) : undefined)));
    expect((await enumerateEightfold(EF)).partial).toBe(true);
  });
  it("is partial when a position has no id, and when pages repeat so fewer distinct ones came back", async () => {
    stubFetch(board(10, () => answer({ data: { count: 10, positions: [...positions(0, 9), { name: "No id" }] } })));
    expect((await enumerateEightfold(EF)).partial).toBe(true);
    stubFetch(board(20, () => answer({ data: { count: 20, positions: positions(0, 10) } })));
    expect((await enumerateEightfold(EF)).partial).toBe(true);
  });
  it("is partial past the page cap, and unread when the first page fails", async () => {
    stubFetch(board((EIGHTFOLD_PAGE_CAP + 1) * 10));
    expect((await enumerateEightfold(EF)).partial).toBe(true);
    stubFetch(() => answer({}, 403));
    expect(await enumerateEightfold(EF)).toEqual({ ats: "eightfold" });
  });
  it("reads an apply_v2 tenant from its own endpoint", async () => {
    const urls: string[] = [];
    stubFetch((u) => {
      urls.push(u);
      return answer({ count: 3, positions: positions(0, 3) });
    });
    const b = await enumerateEightfold({ ...EF, api: "apply_v2", host: "explore.jobs.netflix.net", domain: "netflix.com" });
    expect(urls[0]).toContain("/api/apply/v2/jobs?domain=netflix.com&start=0&query=&num=10");
    expect(b.partial).toBe(false);
  });
  it("Eaton: a list entry absent from the fully read board is stale; from a partly read board it stays 'not fetched'", async () => {
    stubFetch(board(25));
    const read = await enumerateEightfold(EF);
    const title = "Data Scientist - Cleared (Multiple Levels) - Chantilly, VA";
    const linked = row("Eaton", title, { url: "https://eaton.eightfold.ai/careers/job/687999999999" });
    expect(causeOf(linked, undefined, indexCatalog([]), [read])).toMatch(/^stale list entry/);
    expect(causeOf(linked, undefined, indexCatalog([]), [{ ...read, partial: true }])).toMatch(/^watched company, posting not fetched/);
    // Its id on the board, or its title on the board, keeps it live.
    expect(causeOf({ ...linked, url: "https://eaton.eightfold.ai/careers/job/687000000003" }, undefined, indexCatalog([]), [read])).toMatch(/^watched company, posting not fetched/);
    expect(causeOf({ ...linked, title: "Role 3" }, undefined, indexCatalog([]), [read])).toMatch(/^watched company, posting not fetched/);
    // A link with no id (an aggregator page) proves nothing about the board: still "not fetched", as before.
    expect(causeOf(row("Eaton", title, { url: "https://jobright.ai/jobs/info/abc" }), undefined, indexCatalog([]), [read])).toMatch(/^watched company, posting not fetched/);
  });
  it("Booz Allen: a list row under the long name finds the catalog's short-name postings", () => {
    const canon = makeCanon(loadWatchlist().aliases);
    const idx = indexCatalog([job({ key: "workday:bah:r0252610", company: "Booz Allen", title: "University - Data Scientist", triage: { verdict: "reject", rule: "auth.citizenship", reason: "" } })], canon);
    expect(match(row("Booz Allen Hamilton", "University - Data Scientist", { url: "https://jobright.ai/jobs/info/x" }), idx)?.job.key).toBe("workday:bah:r0252610");
  });
});

describe("titles that differ only in a separator before a number", () => {
  it("'Data Science and Analytics04' is 'Data Science and Analytics_04' (Omnicom), and still not 'Analytics 05'", () => {
    const canon = makeCanon(loadWatchlist().aliases);
    const idx = indexCatalog([job({ key: "workday:interpublic:20217327-cm", company: "Omnicom Group", title: "Data Science and Analytics_04", triage: { verdict: "reject", rule: "x", reason: "" } })], canon);
    expect(match(row("Omnicom", "Data Science and Analytics04"), idx)?.job.key).toBe("workday:interpublic:20217327-cm");
    expect(match(row("Omnicom", "Data Science and Analytics05"), idx)).toBeUndefined();
  });
});
