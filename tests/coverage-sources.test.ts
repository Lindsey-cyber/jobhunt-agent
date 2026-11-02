import { afterEach, describe, expect, it, vi } from "vitest";
import { readInFull } from "../src/discover/coverage.ts";
import { enumerateWorkday, readBoard } from "../src/sources/coverage.ts";

// Network answers come from a stub: no board is ever read for real here.
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const stubFetch = (reply: (url: string, body: Record<string, unknown>) => Response) =>
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => reply(String(url), init?.body ? JSON.parse(String(init.body)) : {})));
afterEach(() => vi.unstubAllGlobals());

const SITE = "https://acme.wd5.myworkdayjobs.com/Careers";
const post = (i: number, o: Record<string, unknown> = {}) => ({ title: `Role ${i}`, externalPath: `/job/Austin/Role-${i}_JR${100 + i}`, ...o });
// A Workday board of `total` postings, served 20 to a page; the total is reported on the first page only.
const workday = (total: unknown, extra: (offset: number) => Response | undefined = () => undefined) => (url: string, body: Record<string, unknown>) => {
  const offset = Number(body.offset);
  const special = extra(offset);
  if (special) return special;
  const n = typeof total === "number" ? Math.max(0, Math.min(20, total - offset)) : 1;
  return answer({ total: offset === 0 ? total : 0, jobPostings: Array.from({ length: n }, (_, k) => post(offset + k)) });
};

describe("Workday enumeration", () => {
  it("reads a complete board in full: every id, not partial", async () => {
    stubFetch(workday(45));
    const b = await enumerateWorkday(SITE);
    expect(b).toMatchObject({ ats: "workday", site: "acme/careers", partial: false });
    expect(b.keys).toHaveLength(45);
    expect(b.keys?.[0]).toBe("workday:acme:jr100");
    expect(readInFull(b)).toBe(true);
  });

  it.each([
    ["no total", undefined],
    ["a zero total", 0],
    ["a total that is a string", "45"],
    ["a fractional total", 45.5],
  ])("is partial with %s, though it keeps the postings it listed", async (_name, total) => {
    stubFetch(workday(total));
    const b = await enumerateWorkday(SITE);
    expect(b.partial).toBe(true);
    expect(readInFull(b)).toBe(false);
    expect(b.titles).toBeDefined();
  });

  it("is partial when a later page fails", async () => {
    stubFetch(workday(45, (o) => (o === 20 ? answer({}, 400) : undefined)));
    expect((await enumerateWorkday(SITE)).partial).toBe(true);
  });

  it("is partial when a later page is not a list", async () => {
    stubFetch(workday(45, (o) => (o === 40 ? answer({ total: 0, jobPostings: "error" }) : undefined)));
    expect((await enumerateWorkday(SITE)).partial).toBe(true);
  });

  it("is partial past the page cap (more than 2000 postings)", async () => {
    stubFetch(workday(2100));
    const b = await enumerateWorkday(SITE);
    expect(b.partial).toBe(true);
    expect(b.keys).toHaveLength(2000);
  });

  it("is partial when a posting has no requisition the key can read", async () => {
    stubFetch(workday(20, (o) => (o === 0 ? answer({ total: 20, jobPostings: [post(0), { title: "No path" }, ...Array.from({ length: 18 }, (_, k) => post(k + 1))] }) : undefined)));
    expect((await enumerateWorkday(SITE)).partial).toBe(true);
    stubFetch(workday(20, (o) => (o === 0 ? answer({ total: 20, jobPostings: [post(0, { externalPath: "/job/Austin/Role" }), ...Array.from({ length: 19 }, (_, k) => post(k + 1))] }) : undefined)));
    expect((await enumerateWorkday(SITE)).partial).toBe(true);
  });

  it("names no board when the first request fails, so it proves nothing", async () => {
    stubFetch(() => answer({}, 400));
    const b = await enumerateWorkday(SITE);
    expect(b.titles).toBeUndefined();
    expect(readInFull(b)).toBe(false);
  });
});

describe("official board reads", () => {
  it("reads every Greenhouse id from the board API, before any filtering", async () => {
    stubFetch(() => answer({ jobs: [{ id: 123, title: "ML Engineer" }, { id: 456, title: "Chef" }] }));
    expect(await readBoard("greenhouse", "acme")).toEqual({ ats: "greenhouse", titles: ["ML Engineer", "Chef"], keys: ["greenhouse:123", "greenhouse:456"] });
  });

  it("is unread when the Greenhouse answer has no job list (an empty list would prove every posting gone)", async () => {
    stubFetch(() => answer({ error: "rate limited" }));
    expect(await readBoard("greenhouse", "acme")).toEqual({ ats: "greenhouse" });
  });

  it("reads Ashby ids and treats an unlisted-flag board as read", async () => {
    stubFetch(() => answer({ jobs: [{ id: "6f1e2a3b-0000-4000-8000-000000000001", title: "ML Engineer" }] }));
    const b = await readBoard("ashby", "acme");
    expect(b.keys).toEqual(["ashby:6f1e2a3b-0000-4000-8000-000000000001"]);
    expect(readInFull(b)).toBe(true);
  });

  it("reads every page of a Lever board, and is unread if a page fails", async () => {
    const lever = (skip: number) => (skip === 0 ? Array.from({ length: 250 }, (_, k) => ({ id: `00000000-0000-4000-8000-${String(k).padStart(12, "0")}`, text: `Role ${k}` })) : [{ id: "00000000-0000-4000-8000-999999999999", text: "Last" }]);
    stubFetch((url) => answer(lever(Number(new URL(url).searchParams.get("skip")))));
    const b = await readBoard("lever", "acme");
    expect(b.titles).toHaveLength(251);
    expect(b.keys).toHaveLength(251);
    stubFetch((url) => (new URL(url).searchParams.get("skip") === "250" ? answer({}, 400) : answer(lever(0))));
    expect(await readBoard("lever", "acme")).toEqual({ ats: "lever" });
  });
});
