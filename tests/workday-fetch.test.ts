import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWorkday } from "../src/sources/fetch.ts";

const SITE = { site: "https://acme.wd5.myworkdayjobs.com/Careers", company: "Acme", size: "medium_large" as const };
const NOW = "2026-11-02T12:00:00.000Z";
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

interface Post { title: string; externalPath: string; postedOn: string }
const post = (i: number, postedOn: string, title = `Machine Learning Engineer ${i}`): Post => ({ title, externalPath: `/job/x/ML-${i}`, postedOn });

// A board whose list endpoint serves `posts` in order; total is reported on the first page only, as Workday does.
function board(posts: Post[], opts: { rejectEmpty?: number; failAtOffset?: number } = {}) {
  const listCalls: { offset: number; searchText: string }[] = [];
  const stub = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const b = JSON.parse(String(init.body));
      listCalls.push({ offset: b.offset, searchText: b.searchText });
      if (b.searchText === "" && opts.rejectEmpty) return json({ error: "bad" }, opts.rejectEmpty);
      if (b.offset === opts.failAtOffset) return json({}, 400);
      const matching = b.searchText ? posts.filter((p) => p.title.toLowerCase().includes(String(b.searchText).toLowerCase())) : posts;
      return json({ total: b.offset === 0 ? matching.length : 0, jobPostings: matching.slice(b.offset, b.offset + b.limit) });
    }
    const path = new URL(url).pathname.replace(/^.*\/Careers/, "");
    const p = posts.find((x) => x.externalPath === path);
    return p ? json({ jobPostingInfo: { title: p.title, postedOn: p.postedOn, jobDescription: "Build models.", location: "Remote", externalUrl: `https://acme.wd5.myworkdayjobs.com/Careers${p.externalPath}`, country: { descriptor: "United States of America" } } }) : json({}, 404);
  });
  vi.stubGlobal("fetch", stub);
  return { listCalls };
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchWorkday full walk", () => {
  it("pages with an empty search past the first page, and reads every AI/ML title", async () => {
    const posts = Array.from({ length: 45 }, (_, i) => post(i, "Posted Today"));
    const { listCalls } = board(posts);
    const r = await fetchWorkday(SITE, ["new grad"], NOW);
    expect(listCalls.map((c) => c.offset)).toEqual([0, 20, 40]);
    expect(listCalls.every((c) => c.searchText === "")).toBe(true);
    expect(r.sightings).toHaveLength(45);
    expect(r.outcome).toMatchObject({ ok: true, pages: 3, listed: 45, capHit: false });
  });

  it("a target posted '30+ Days Ago' behind 40 recent postings is fetched when the cap is above its page", async () => {
    // Target at index 95 of the '30+' run, i.e. list position 135 (on the 7th of the 8 allowed pages); no date stops the walk.
    const posts = [...Array.from({ length: 40 }, (_, i) => post(i, "Posted 2 Days Ago")), ...Array.from({ length: 100 }, (_, i) => post(100 + i, "Posted 30+ Days Ago", i === 95 ? "Data Engineer - Early Career" : `Machine Learning Engineer ${100 + i}`))];
    const { listCalls } = board(posts);
    const r = await fetchWorkday(SITE, [], NOW, { pageCap: 8 });
    expect(listCalls.map((c) => c.offset)).toEqual([0, 20, 40, 60, 80, 100, 120]);
    expect(r.sightings.map((x) => x.title)).toContain("Data Engineer - Early Career");
    expect(r.outcome).toMatchObject({ capHit: false, listed: 140 });
  });

  it("without a last-run bound, '30+ Days Ago' postings are open postings: the walk reads them to the end of the list (GM / Omnicom shape)", async () => {
    // Boards that are not date-ordered put their early-career roles behind 30+ pages; stopping there never fetched them.
    const posts = [...Array.from({ length: 40 }, (_, i) => post(i, "Posted 2 Days Ago")), ...Array.from({ length: 100 }, (_, i) => post(100 + i, "Posted 30+ Days Ago", i === 95 ? "Data Engineer - Early Career" : `Machine Learning Engineer ${100 + i}`))];
    const { listCalls } = board(posts);
    const r = await fetchWorkday(SITE, [], NOW);
    expect(listCalls.map((c) => c.offset)).toEqual([0, 20, 40, 60, 80, 100, 120]);
    expect(r.sightings.map((x) => x.title)).toContain("Data Engineer - Early Career");
    expect(r.outcome).toMatchObject({ capHit: false, listed: 140 });
    expect(r.outcome.note).toMatch(/end of list/);
  });

  it("'5 days ago' postings are read in full, not cut by age", async () => {
    const posts = Array.from({ length: 60 }, (_, i) => post(i, "Posted 5 Days Ago"));
    const { listCalls } = board(posts);
    await fetchWorkday(SITE, [], NOW);
    expect(listCalls).toHaveLength(3);
  });

  it("the hard page cap bounds a huge fresh board and says so", async () => {
    const posts = Array.from({ length: 500 }, (_, i) => post(i, "Posted Today"));
    const { listCalls } = board(posts);
    const r = await fetchWorkday(SITE, [], NOW, { pageCap: 3 });
    expect(listCalls).toHaveLength(3);
    expect(r.sightings).toHaveLength(60);
    expect(r.outcome).toMatchObject({ pages: 3, capHit: true });
    expect(r.outcome.note).toMatch(/recall bounded/);
  });

  it("a board that ends exactly at the cap is not reported as capped", async () => {
    board(Array.from({ length: 60 }, (_, i) => post(i, "Posted Today")));
    const r = await fetchWorkday(SITE, [], NOW, { pageCap: 3 });
    expect(r.outcome).toMatchObject({ pages: 3, capHit: false });
  });

  it("ignores non-AI/ML titles for detail fetch but counts them as listed", async () => {
    board([post(0, "Posted Today"), post(1, "Posted Today", "Account Executive")]);
    const r = await fetchWorkday(SITE, [], NOW);
    expect(r.sightings).toHaveLength(1);
    expect(r.outcome.listed).toBe(2);
  });

  it("an empty board is ok with zero postings", async () => {
    board([]);
    const r = await fetchWorkday(SITE, [], NOW);
    expect(r.outcome).toMatchObject({ ok: true, count: 0, pages: 1, capHit: false });
  });

  it("an error after the first page keeps what was read and marks recall bounded", async () => {
    board(Array.from({ length: 60 }, (_, i) => post(i, "Posted Today")), { failAtOffset: 20 });
    const r = await fetchWorkday(SITE, [], NOW);
    expect(r.outcome).toMatchObject({ ok: true, pages: 1, capHit: true });
    expect(r.sightings).toHaveLength(20);
  });
});

describe("fetchWorkday keyword fallback", () => {
  it("falls back to keyword search when the board rejects an empty search", async () => {
    const posts = [post(0, "Posted Today"), post(1, "Posted Today", "Software Engineer, New Grad AI")];
    const { listCalls } = board(posts, { rejectEmpty: 400 });
    const r = await fetchWorkday(SITE, ["machine learning", "new grad"], NOW);
    expect(listCalls.map((c) => c.searchText)).toEqual(["", "machine learning", "new grad"]);
    expect(r.outcome).toMatchObject({ ok: true, capHit: true });
    expect(r.outcome.note).toMatch(/keyword fallback/);
    expect(r.sightings).toHaveLength(2);
  });

  it("a server error on the empty search fails the board instead of falling back", async () => {
    board([post(0, "Posted Today")], { rejectEmpty: 503 });
    const r = await fetchWorkday(SITE, ["new grad"], NOW);
    expect(r.outcome.ok).toBe(false);
  }, 30000);
});
