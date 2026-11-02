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

  it("stops after two consecutive pages that are entirely '30+ Days Ago'", async () => {
    const posts = [...Array.from({ length: 22 }, (_, i) => post(i, "Posted 2 Days Ago")), ...Array.from({ length: 80 }, (_, i) => post(100 + i, "Posted 30+ Days Ago"))];
    const { listCalls } = board(posts);
    const r = await fetchWorkday(SITE, [], NOW);
    expect(listCalls.map((c) => c.offset)).toEqual([0, 20, 40, 60]);
    expect(r.outcome.capHit).toBe(false);
    expect(r.outcome.note).toMatch(/older than the window/);
  });

  it("a long stale run in the middle of fresh postings (Adobe's real shape) does not end the walk", async () => {
    const posts = [...Array.from({ length: 9 }, (_, i) => post(i, "Posted 3 Days Ago")), ...Array.from({ length: 23 }, (_, i) => post(100 + i, "Posted 30+ Days Ago")), ...Array.from({ length: 30 }, (_, i) => post(200 + i, "Posted Today"))];
    const { listCalls } = board(posts);
    const r = await fetchWorkday(SITE, [], NOW);
    expect(listCalls.map((c) => c.offset)).toEqual([0, 20, 40, 60]);
    expect(r.sightings).toHaveLength(62);
  });

  it("a single stale posting between fresh ones (pinned or reposted) does not stop the walk", async () => {
    const posts = [post(0, "Posted Today"), post(1, "Posted 30+ Days Ago"), ...Array.from({ length: 30 }, (_, i) => post(10 + i, "Posted Yesterday"))];
    const { listCalls } = board(posts);
    const r = await fetchWorkday(SITE, [], NOW);
    expect(listCalls).toHaveLength(2);
    expect(r.sightings).toHaveLength(32);
  });

  it("stops on a page fully older than the last successful run", async () => {
    const posts = [...Array.from({ length: 20 }, (_, i) => post(i, "Posted Today")), ...Array.from({ length: 60 }, (_, i) => post(100 + i, "Posted 5 Days Ago"))];
    const { listCalls } = board(posts);
    const r = await fetchWorkday(SITE, [], NOW, { since: "2026-11-01T00:00:00.000Z" });
    expect(listCalls.map((c) => c.offset)).toEqual([0, 20, 40]);
    expect(r.outcome.capHit).toBe(false);
  });

  it("without the since bound, '5 days ago' postings are still in the window", async () => {
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
