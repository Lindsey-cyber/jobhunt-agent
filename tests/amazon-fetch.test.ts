import { afterEach, describe, expect, it, vi } from "vitest";
import { inScopeTitle } from "../src/discover/triage.ts";
import { AMAZON_PER_QUERY, fetchAmazon, loadWatchlist } from "../src/sources/fetch.ts";

const NOW = "2026-11-02T12:00:00.000Z";
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
const job = (id: number, title: string) => ({ id_icims: String(id), title, job_path: `/en/jobs/${id}/x`, posted_date: "October 28, 2026", normalized_location: "Seattle, Washington, USA", country_code: "USA" });

// A search.json that serves `jobs` newest first for every query and reports the total as `hits`.
function amazon(jobs: ReturnType<typeof job>[]) {
  const offsets: number[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = new URL(url);
    const offset = Number(u.searchParams.get("offset") ?? 0);
    offsets.push(offset);
    return json({ hits: jobs.length, jobs: jobs.slice(offset, offset + Number(u.searchParams.get("result_limit"))) });
  }));
  return offsets;
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchAmazon", () => {
  it("reads a query to the end of its hits, not just the newest 200 (Fire TV Data Engineer I sat at hit 450 of 'machine learning')", async () => {
    const jobs = Array.from({ length: 450 }, (_, i) => job(1000 + i, i === 449 ? "Data Engineer I, Fire TV" : `Machine Learning Engineer ${i}`));
    const offsets = amazon(jobs);
    const r = await fetchAmazon(["machine learning"], NOW);
    expect(offsets).toEqual([0, 100, 200, 300, 400]);
    expect(r.sightings.map((s) => s.title)).toContain("Data Engineer I, Fire TV");
    expect(r.sightings).toHaveLength(450);
  });

  it("stops when a page is the last one, without asking past the total", async () => {
    const offsets = amazon(Array.from({ length: 100 }, (_, i) => job(i, `ML Engineer ${i}`)));
    await fetchAmazon(["ML engineer"], NOW);
    expect(offsets).toEqual([0]);
  });

  it("an empty answer is ok with no postings", async () => {
    const offsets = amazon([]);
    const r = await fetchAmazon(["data engineer"], NOW);
    expect(offsets).toEqual([0]);
    expect(r.outcome).toMatchObject({ ok: true, count: 0 });
  });

  it("the safety cap still bounds a query and the default is deeper than the biggest real query (2100 hits)", async () => {
    expect(AMAZON_PER_QUERY).toBeGreaterThanOrEqual(2500);
    const offsets = amazon(Array.from({ length: 500 }, (_, i) => job(i, `ML Engineer ${i}`)));
    await fetchAmazon(["machine learning"], NOW, 200);
    expect(offsets).toEqual([0, 100]);
  });

  it("keeps only in-scope titles but still keeps an out-of-scope-for-the-candidate role that names AI (triage rejects it later)", async () => {
    amazon([job(1, "Executive Assistant, AWS AI Platforms"), job(2, "Warehouse Associate")]);
    const r = await fetchAmazon(["artificial intelligence"], NOW);
    expect(r.sightings.map((s) => s.title)).toEqual(["Executive Assistant, AWS AI Platforms"]);
  });
});

describe("watchlist boards for the watched large companies", () => {
  const w = loadWatchlist();
  it("Amazon has a query for every title family the scope predicate accepts as its own search term", () => {
    // 'data engineer' titles (inScopeTitle ROLE) are not reached through 'machine learning' / 'ML engineer'.
    expect(inScopeTitle("Data Engineer I, Fire TV")).toBe(true);
    expect(w.amazon!.queries).toContain("data engineer");
  });

  it("Qualcomm is read from its Eightfold career site; its Workday site answers an empty board and is not listed", () => {
    expect(w.eightfold.find((e) => e.company === "Qualcomm")).toMatchObject({ host: "careers.qualcomm.com", domain: "qualcomm.com", api: "pcsx", band: "large" });
    expect(w.workday.some((x) => x.company === "Qualcomm")).toBe(false);
  });
});
