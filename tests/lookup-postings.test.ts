import { afterEach, describe, expect, it, vi } from "vitest";
import type { Job, JobKey, Sighting } from "../src/domain/job.ts";
import { mergeRun } from "../src/discover/merge.ts";
import { isDated } from "../src/discover/gates.ts";
import { lookupTargets } from "../src/run/discover.ts";
import { fetchPostings, hostedBoard, workdayRef } from "../src/sources/fetch.ts";

const NOW = "2026-11-02T12:00:00.000Z";
const me = { needsSponsorship: true, usCitizen: false, hasPhd: false };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

describe("workdayRef / hostedBoard", () => {
  it("drops the locale segment and reads the requisition id", () => {
    expect(workdayRef("https://ace.wd5.myworkdayjobs.com/en-US/careers/job/Costa-Mesa-CA/Associate-Data-Engineer_JR202639452")).toMatchObject({ tenant: "ace", site: "careers", req: "JR202639452", path: "/job/Costa-Mesa-CA/Associate-Data-Engineer_JR202639452" });
    expect(workdayRef("https://amgen.wd1.myworkdayjobs.com/Careers/job/US-Remote/Data-Scientist_R-257589")).toMatchObject({ site: "Careers", req: "R-257589" });
  });
  it("refuses anything that is not a posting URL", () => {
    expect(workdayRef("https://ace.wd5.myworkdayjobs.com/en-US/careers")).toBeUndefined();
    expect(workdayRef("https://example.com/job/x_R1")).toBeUndefined();
    expect(workdayRef("not a url")).toBeUndefined();
  });
  it("names a hosted board, but not an employer-domain gh_jid link", () => {
    expect(hostedBoard("https://job-boards.greenhouse.io/trueanomalyinc/jobs/5223279007")).toEqual({ kind: "greenhouse", board: "trueanomalyinc", id: "5223279007" });
    expect(hostedBoard("https://jobs.lever.co/auw/515a3498-4257-4e68-91ff-cf82e854f12d")).toMatchObject({ kind: "lever", board: "auw" });
    expect(hostedBoard("https://westmonroe.com/careers/job-details-students?gh_jid=6183029004")).toBeUndefined();
    expect(hostedBoard("https://boards.greenhouse.io/embed/job_app?token=1")).toBeUndefined();
  });
});

function workdayStub(listed: { externalPath: string; postedOn: string; title?: string }[], detailStatus = 200) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return json({ total: listed.length, jobPostings: listed.map((p) => ({ title: p.title ?? "ML Engineer", ...p })) });
    if (detailStatus !== 200) return json({}, detailStatus);
    return json({ jobPostingInfo: { title: "ML Engineer", jobDescription: "Build models.", location: "Austin, TX", externalUrl: String(url).replace("/wday/cxs/acme", "") , country: { descriptor: "United States of America" } } });
  }));
}
const WD = { url: "https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Austin-TX/ML-Engineer_R-123", company: "Acme" };

describe("fetchPostings: workday", () => {
  it("dates a listed posting from the list's own relative age", async () => {
    workdayStub([{ externalPath: "/job/Austin-TX/ML-Engineer_R-123", postedOn: "Posted 3 Days Ago" }]);
    const r = await fetchPostings("workday", [WD], NOW);
    expect(r.sightings).toHaveLength(1);
    expect(r.sightings[0]).toMatchObject({ official: true, key: "workday:acme:r-123", dateKind: "relative_posted", date: "2026-10-30T00:00:00.000Z" });
  });
  it("keeps '30+ Days Ago' a bound, never a publication date", async () => {
    workdayStub([{ externalPath: "/job/Austin-TX/ML-Engineer_R-123", postedOn: "Posted 30+ Days Ago" }]);
    const s = (await fetchPostings("workday", [WD], NOW)).sightings[0]!;
    expect(s.dateKind).toBe("posted_before");
    const jobs = mergeRun(new Map(), [s], me);
    expect(isDated([...jobs.values()][0]!)).toBe(false);
  });
  it("finds nothing when the requisition is no longer listed, and never matches a different requisition", async () => {
    workdayStub([{ externalPath: "/job/Austin-TX/Other_R-1234", postedOn: "Posted Today" }]);
    const r = await fetchPostings("workday", [WD], NOW);
    expect(r.sightings).toHaveLength(1);
    expect(r.sightings[0]).toMatchObject({ key: "workday:acme:r-123", official: false, hints: { closed: true, closedEvidence: { source: "lookup:workday", checkedAt: NOW } } });
    expect(r.outcome).toMatchObject({ ok: true, count: 0 });
    expect(r.outcome.note).toMatch(/1 proved gone/);
  });
  it("a posting whose detail is refused (403) is closed, not an error", async () => {
    workdayStub([{ externalPath: "/job/Austin-TX/ML-Engineer_R-123", postedOn: "Posted Today" }], 403);
    const r = await fetchPostings("workday", [WD], NOW);
    expect(r.sightings).toEqual([]);
    expect(r.outcome.note).toMatch(/0 failed/);
  });
  it("Workday: an ambiguous answer is not proof (no posting list, partial page, 404 on the search, network error)", async () => {
    const cases: (() => Response)[] = [() => json({}), () => json({ total: 50, jobPostings: [{ externalPath: "/job/x/Other_R-9", postedOn: "Posted Today" }] }), () => json({}, 404)];
    for (const c of cases) {
      vi.stubGlobal("fetch", vi.fn(async () => c()));
      expect((await fetchPostings("workday", [WD], NOW)).sightings).toEqual([]);
    }
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const r = await fetchPostings("workday", [WD], NOW);
    expect(r.sightings).toEqual([]);
    expect(r.outcome.note).toMatch(/1 failed/);
  }, 30000);
  it("Workday: listed but detail refused is not claimed closed", async () => {
    workdayStub([{ externalPath: "/job/Austin-TX/ML-Engineer_R-123", postedOn: "Posted Today" }], 404);
    expect((await fetchPostings("workday", [WD], NOW)).sightings).toEqual([]);
  });
  it("a server error is counted as failed and does not abort the other targets", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 400)));
    const r = await fetchPostings("workday", [WD, { url: "https://x.example/none", company: "X" }], NOW);
    expect(r.sightings).toEqual([]);
    expect(r.outcome.ok).toBe(true);
  });
});

const LEVER = { url: "https://jobs.lever.co/auw/515a3498-4257-4e68-91ff-cf82e854f12d", company: "AUW" };

describe("fetchPostings: other ATS", () => {
  it("SmartRecruiters: the release date is a publication date", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ id: "3743990016070676", name: "Associate Data Scientist I", releasedDate: "2026-10-20T10:00:00.000Z", location: { city: "Chicago", region: "IL" } })));
    const r = await fetchPostings("smartrecruiters", [{ url: "https://jobs.smartrecruiters.com/AbbVie/3743990016070676", company: "AbbVie" }], NOW);
    expect(r.sightings[0]).toMatchObject({ key: "smartrecruiters:3743990016070676", dateKind: "published", official: true });
  });
  it("Amazon: only the posting with that id counts, not other search hits", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ hits: 2, jobs: [
      { title: "SDE", job_path: "/en/jobs/111/sde", posted_date: "August 12, 2026", id_icims: "111" },
      { title: "Other", job_path: "/en/jobs/222/other", posted_date: "August 13, 2026", id_icims: "222" },
    ] })));
    const r = await fetchPostings("amazon", [{ url: "https://www.amazon.jobs/jobs/111/apply", company: "Amazon" }], NOW);
    expect(r.sightings.map((s) => s.key)).toEqual(["amazon:111"]);
    expect(r.sightings[0]!.dateKind).toBe("published");
  });
  it("Lever: a 404 for the job proves it gone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ ok: false, error: "Document not found" }, 404)));
    const r = await fetchPostings("lever", [LEVER], NOW);
    expect(r.sightings).toHaveLength(1);
    expect(r.sightings[0]).toMatchObject({ hints: { closed: true, closedEvidence: { source: "lookup:lever" } } });
    expect(r.outcome.note).toMatch(/1 proved gone/);
  });
  it("Greenhouse: 404 and 410 prove it gone, 403 and 400 do not", async () => {
    const gh = { url: "https://job-boards.greenhouse.io/acme/jobs/123", company: "Acme" };
    for (const [status, closed] of [[404, true], [410, true], [403, false], [400, false]] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => json({}, status)));
      expect((await fetchPostings("greenhouse", [gh], NOW)).sightings.length).toBe(closed ? 1 : 0);
    }
  });
  it("a network error or a server error never marks a posting closed", async () => {
    for (const f of [vi.fn(async () => { throw new TypeError("fetch failed"); }), vi.fn(async () => json({}, 503))]) {
      vi.stubGlobal("fetch", f);
      const r = await fetchPostings("lever", [LEVER], NOW);
      expect(r.sightings).toEqual([]);
      expect(r.outcome.note).toMatch(/1 failed/);
    }
  }, 30000);
  it("SmartRecruiters: 404 proves it gone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 404)));
    const r = await fetchPostings("smartrecruiters", [{ url: "https://jobs.smartrecruiters.com/AbbVie/3743990016070676", company: "AbbVie" }], NOW);
    expect(r.sightings[0]?.hints.closed).toBe(true);
  });
  it("Amazon: an answer with no jobs proves it gone; an answer with only other jobs is not claimed", async () => {
    const t = [{ url: "https://www.amazon.jobs/jobs/111/apply", company: "Amazon" }];
    vi.stubGlobal("fetch", vi.fn(async () => json({ hits: 0, jobs: [] })));
    expect((await fetchPostings("amazon", t, NOW)).sightings[0]?.hints.closed).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => json({ hits: 1 })));
    expect((await fetchPostings("amazon", t, NOW)).sightings).toEqual([]);
  });
  it("Greenhouse: a link without a hosted board is not looked up at all", async () => {
    const stub = vi.fn(async () => json({}));
    vi.stubGlobal("fetch", stub);
    const r = await fetchPostings("greenhouse", [{ url: "https://westmonroe.com/careers/x?gh_jid=6183029004", company: "WM" }], NOW);
    expect(r.sightings).toEqual([]);
    expect(stub).not.toHaveBeenCalled();
  });
});

describe("lookupTargets", () => {
  const sg = (key: string, url: string, over: Partial<Sighting> = {}): Sighting => ({
    channel: "github_newgrad", source: "list", url, key: key as JobKey, seenAt: NOW, official: false, company: "Acme",
    title: "Machine Learning Engineer, New Grad", location: "New York, NY", description: "", date: "3d", dateKind: "list_age_day", hints: {}, ...over,
  });
  const WDK = "workday:acme:r-123";
  const flat = (m: ReturnType<typeof lookupTargets>) => [...m.values()].flat().map((t) => t.key);

  it("selects third-party sightings on a lookup-able ATS, once each", () => {
    const m = lookupTargets([sg(WDK, WD.url), sg(WDK, WD.url, { source: "list2" }), sg("smartrecruiters:9", "https://jobs.smartrecruiters.com/A/9")], new Map(), me);
    expect(flat(m).sort()).toEqual([WDK, "smartrecruiters:9"].sort());
  });
  it("skips ATS we cannot ask, rejected roles, and postings an official source already gave this run", () => {
    const m = lookupTargets([
      sg("url:https://zapply.jobs/x", "https://zapply.jobs/x"),
      sg("workday:acme:r-9", WD.url.replace("123", "9"), { title: "Senior Staff Machine Learning Engineer" }),
      sg(WDK, WD.url),
      sg(WDK, WD.url, { official: true, channel: "official_workday" }),
    ], new Map(), me);
    expect(flat(m)).toEqual([]);
  });
  it("skips a posting the catalog already holds as official and dated, but not an official one without a date", () => {
    const held = (publishedAt: string) => new Map([[WDK as JobKey, { key: WDK, official: true, publishedAt } as Job]]);
    expect(flat(lookupTargets([sg(WDK, WD.url)], held("2026-10-01T00:00:00.000Z"), me))).toEqual([]);
    expect(flat(lookupTargets([sg(WDK, WD.url)], held(""), me))).toEqual([WDK]);
  });
  it("caps the number of lookups", () => {
    const many = Array.from({ length: 10 }, (_, i) => sg(`smartrecruiters:${i + 1}`, `https://jobs.smartrecruiters.com/A/${i + 1}`));
    expect(flat(lookupTargets(many, new Map(), me, 4))).toHaveLength(4);
  });
});

describe("a looked-up posting dates the list entry through merge", () => {
  it("the official sighting turns the list-only match into a dated one", () => {
    const list: Sighting = { channel: "github_newgrad", source: "list", url: "https://jobs.smartrecruiters.com/A/9", key: "smartrecruiters:9" as JobKey, seenAt: NOW, official: false, company: "A", title: "Machine Learning Engineer, New Grad", location: "New York, NY", description: "", date: "2w", dateKind: "list_age", hints: {} };
    expect(isDated([...mergeRun(new Map(), [list], me).values()][0]!)).toBe(false);
    const official: Sighting = { ...list, channel: "official_smartrecruiters", source: "https://jobs.smartrecruiters.com/A", official: true, date: "2026-10-20T00:00:00.000Z", dateKind: "published" };
    const merged = [...mergeRun(new Map(), [list, official], me).values()][0]!;
    expect(merged.official).toBe(true);
    expect(isDated(merged)).toBe(true);
  });
});

describe("a posting proved gone leaves the matches", () => {
  const list: Sighting = { channel: "github_newgrad", source: "list", url: "https://jobs.smartrecruiters.com/A/9", key: "smartrecruiters:9" as JobKey, seenAt: NOW, official: false, company: "A", title: "Machine Learning Engineer, New Grad", location: "New York, NY", description: "", date: "2026-10-30T00:00:00.000Z", dateKind: "list_age_day", hints: {} };
  const gone: Sighting = { ...list, source: "lookup:smartrecruiters", channel: "official_smartrecruiters", title: "", date: "", dateKind: "none", hints: { closed: true, closedEvidence: { source: "lookup:smartrecruiters", checkedAt: NOW, basis: "404" } } };
  it("triage rejects it as source.closed and keeps the evidence, though a list still shows it", () => {
    expect([...mergeRun(new Map(), [list], me).values()][0]!.triage.verdict).toBe("match");
    const j = [...mergeRun(new Map(), [list, gone], me).values()][0]!;
    expect(j.triage).toMatchObject({ verdict: "reject", rule: "source.closed" });
    expect(j.hints.closedEvidence).toMatchObject({ source: "lookup:smartrecruiters", checkedAt: NOW });
    expect(j.title).toBe(list.title);
  });
  it("stays closed next run from the list alone, and reopens when an official source lists it", () => {
    const first = mergeRun(new Map(), [list, gone], me);
    const again = [...mergeRun(first, [{ ...list, seenAt: "2026-11-03T00:00:00.000Z" }], me).values()][0]!;
    expect(again.triage.rule).toBe("source.closed");
    const official: Sighting = { ...list, channel: "official_smartrecruiters", official: true, source: "sr:A", date: "2026-10-20T00:00:00.000Z", dateKind: "published" };
    const back = [...mergeRun(first, [list, official], me).values()][0]!;
    expect(back.hints.closed).toBe(false);
    expect(back.hints.closedEvidence).toBeUndefined();
    expect(back.triage.verdict).toBe("match");
  });
});
