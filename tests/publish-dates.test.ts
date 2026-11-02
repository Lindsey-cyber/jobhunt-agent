import { describe, expect, it } from "vitest";
import { mergeRun } from "../src/discover/merge.ts";
import { parseAshby, parseGreenhouse, parseLever, parseListAge, parseMarkdownJobTable, parseSimplifyListings, parseWorkdayDetail, type WorkdayDetail } from "../src/discover/parse.ts";
import type { CandidateFacts } from "../src/discover/triage.ts";

const me: CandidateFacts = { needsSponsorship: true, usCitizen: false, hasPhd: false };
const omit = <T extends object, K extends keyof T>(o: T, k: K): Omit<T, K> => {
  const { [k]: _drop, ...rest } = o;
  return rest;
};
const NOW = "2026-11-02T15:30:00.000Z";

describe("Greenhouse publish date", () => {
  const job = { id: 1, title: "ML Engineer", absolute_url: "https://x.com/?gh_jid=1", location: { name: "NYC" }, first_published: "2026-09-16T09:11:57-04:00", updated_at: "2026-10-06T07:04:54-04:00" };
  it("uses first_published (list endpoint, no content needed), not updated_at", () => {
    const [s] = parseGreenhouse({ jobs: [job] }, "acme", "Acme", NOW);
    expect(s!.date).toBe("2026-09-16T13:11:57.000Z");
    expect(s!.dateKind).toBe("published");
  });
  it("falls back to updated_at labelled updated when first_published is missing", () => {
    const [s] = parseGreenhouse({ jobs: [omit(job, "first_published")] }, "acme", "Acme", NOW);
    expect(s!.dateKind).toBe("updated");
    expect(s!.date).toBe("2026-10-06T11:04:54.000Z");
  });
  it("is none, with an empty date, when neither field parses", () => {
    const [s] = parseGreenhouse({ jobs: [{ ...omit(job, "updated_at"), first_published: "garbage" }] }, "acme", "Acme", NOW);
    expect(s).toMatchObject({ date: "", dateKind: "none" });
  });
});

describe("Lever publish date", () => {
  const job = { id: "a", text: "ML Engineer", hostedUrl: "https://jobs.lever.co/acme/aaaaaaaa-0000-0000-0000-000000000000", createdAt: 1761231640768 };
  it("reads createdAt (epoch ms) as published", () => {
    const [s] = parseLever([job], "acme", "Acme", NOW);
    expect(s).toMatchObject({ date: "2025-10-23T15:00:40.768Z", dateKind: "published" });
  });
  it("is none when createdAt is absent", () => {
    const [s] = parseLever([omit(job, "createdAt")], "acme", "Acme", NOW);
    expect(s).toMatchObject({ date: "", dateKind: "none" });
  });
});

describe("Ashby publish date", () => {
  const job = { id: "a", title: "ML Engineer", jobUrl: "https://jobs.ashbyhq.com/acme/11111111-1111-1111-1111-111111111111", publishedAt: "2026-08-30T05:31:25.211+00:00" };
  it("reads publishedAt as published", () => {
    const [s] = parseAshby({ jobs: [job] }, "acme", "Acme", NOW);
    expect(s).toMatchObject({ date: "2026-08-30T05:31:25.211Z", dateKind: "published" });
  });
  it("is none when publishedAt is absent, and unlisted jobs are dropped", () => {
    const out = parseAshby({ jobs: [omit(job, "publishedAt"), { ...job, jobUrl: job.jobUrl.replace("1111", "2222"), isListed: false }] }, "acme", "Acme", NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ date: "", dateKind: "none" });
  });
});

describe("Workday publish date", () => {
  const site = "https://x.wd1.myworkdayjobs.com/Ext";
  const detail = (postedOn?: string): WorkdayDetail => ({ jobPostingInfo: { title: "ML Engineer", ...(postedOn ? { postedOn } : {}), startDate: "2026-12-01", externalUrl: `${site}/job/NY/ML-Engineer_R1` } });
  it("Posted N Days Ago is the employer's relative date", () => {
    expect(parseWorkdayDetail(detail(), site, "/job/NY/ML-Engineer_R1", "X", NOW, "Posted 3 Days Ago")).toMatchObject({ date: "2026-10-30T00:00:00.000Z", dateKind: "relative_posted" });
  });
  it("30+ days is a bound, and with no age at all only the start date remains", () => {
    expect(parseWorkdayDetail(detail(), site, "/p", "X", NOW, "Posted 30+ Days Ago")?.dateKind).toBe("posted_before");
    expect(parseWorkdayDetail(detail(), site, "/p", "X", NOW)?.dateKind).toBe("start_date");
  });
  it("takes the detail's postedOn when the list had none", () => {
    expect(parseWorkdayDetail(detail("Posted Yesterday"), site, "/p", "X", NOW)).toMatchObject({ date: "2026-11-01T00:00:00.000Z", dateKind: "relative_posted" });
  });
});

describe("GitHub list dates", () => {
  it("Simplify date_posted (epoch seconds) is list_posted; a row without one is none", () => {
    const rows = parseSimplifyListings(
      [
        { company_name: "A", title: "New Grad ML", url: "https://a.com/j/1", date_posted: 1773181843 },
        { company_name: "B", title: "New Grad ML", url: "https://b.com/j/2" },
      ],
      "https://github.com/x/y",
      NOW,
    );
    expect(rows[0]).toMatchObject({ date: "2026-03-10T22:30:43.000Z", dateKind: "list_posted" });
    expect(rows[1]).toMatchObject({ date: "", dateKind: "none" });
  });

  const table = (age: string) =>
    ["| Company | Role | Location | Posting | Age |", "|---|---|---|---|---|", `| **Acme** | ML Engineer | NYC | <a href="https://acme.com/jobs/1">Apply</a> | ${age} |`].join("\n");

  it("resolves an age cell to a day and keeps it labelled list_age", () => {
    const [s] = parseMarkdownJobTable(table("2d"), "https://github.com/x/y", NOW);
    expect(s).toMatchObject({ date: "2026-10-31T00:00:00.000Z", dateKind: "list_age" });
  });
  it("a list age is never an employer publish date: merge leaves publishedAt empty", () => {
    const sightings = parseMarkdownJobTable(table("2d"), "https://github.com/x/y", NOW);
    const job = [...mergeRun(new Map(), sightings, me).values()][0]!;
    expect(job.publishedAt).toBe("");
    expect(job.sources[0]).toMatchObject({ dateKind: "list_age" });
  });
  it("parseListAge handles every cell shape the lists use", () => {
    expect(parseListAge("today", NOW)).toEqual({ date: "2026-11-02T00:00:00.000Z", dateKind: "list_age" });
    expect(parseListAge("1w", NOW)).toEqual({ date: "2026-10-26T00:00:00.000Z", dateKind: "list_age" });
    expect(parseListAge("2mo", NOW)).toEqual({ date: "2026-09-03T00:00:00.000Z", dateKind: "list_age" });
    expect(parseListAge("2026-08-20", NOW)).toEqual({ date: "2026-08-20T00:00:00.000Z", dateKind: "list_age" });
    expect(parseListAge("30d+", NOW).dateKind).toBe("posted_before");
    expect(parseListAge("30+ days", NOW).dateKind).toBe("posted_before");
    expect(parseListAge("Date unknown", NOW)).toEqual({ date: "", dateKind: "none" });
    expect(parseListAge("", NOW)).toEqual({ date: "", dateKind: "none" });
    expect(parseListAge("2d", "nope")).toEqual({ date: "", dateKind: "none" });
    expect(parseListAge("2026-13-45", NOW)).toEqual({ date: "", dateKind: "none" });
  });
});

describe("merge keeps a recorded publish date", () => {
  it("an official sighting with no date does not erase the date already known", () => {
    const [full] = parseAshby({ jobs: [{ id: "a", title: "ML Engineer", jobUrl: "https://jobs.ashbyhq.com/acme/11111111-1111-1111-1111-111111111111", publishedAt: "2026-08-30T05:31:25.211Z" }] }, "acme", "Acme", NOW);
    const [bare] = parseAshby({ jobs: [{ id: "a", title: "ML Engineer", jobUrl: "https://jobs.ashbyhq.com/acme/11111111-1111-1111-1111-111111111111" }] }, "acme", "Acme", "2026-11-03T15:30:00.000Z");
    const first = mergeRun(new Map(), [full!], me);
    const second = mergeRun(first, [bare!], me);
    expect([...second.values()][0]!.publishedAt).toBe("2026-08-30T05:31:25.211Z");
  });
  it("a later sighting with no date keeps the source record's earlier date and kind", () => {
    const [full] = parseAshby({ jobs: [{ id: "a", title: "ML Engineer", jobUrl: "https://jobs.ashbyhq.com/acme/11111111-1111-1111-1111-111111111111", publishedAt: "2026-08-30T05:31:25.211Z" }] }, "acme", "Acme", NOW);
    const [bare] = parseAshby({ jobs: [{ id: "a", title: "ML Engineer", jobUrl: "https://jobs.ashbyhq.com/acme/11111111-1111-1111-1111-111111111111" }] }, "acme", "Acme", "2026-11-03T15:30:00.000Z");
    const second = mergeRun(mergeRun(new Map(), [full!], me), [bare!], me);
    expect([...second.values()][0]!.sources[0]).toMatchObject({ date: "2026-08-30T05:31:25.211Z", dateKind: "published" });
  });
  it("a later sighting with a date still replaces the source record's date", () => {
    const [full] = parseAshby({ jobs: [{ id: "a", title: "ML Engineer", jobUrl: "https://jobs.ashbyhq.com/acme/11111111-1111-1111-1111-111111111111", publishedAt: "2026-08-30T05:31:25.211Z" }] }, "acme", "Acme", NOW);
    const [moved] = parseAshby({ jobs: [{ id: "a", title: "ML Engineer", jobUrl: "https://jobs.ashbyhq.com/acme/11111111-1111-1111-1111-111111111111", publishedAt: "2026-09-01T00:00:00.000Z" }] }, "acme", "Acme", "2026-11-03T15:30:00.000Z");
    const second = mergeRun(mergeRun(new Map(), [full!], me), [moved!], me);
    expect([...second.values()][0]!.sources[0]).toMatchObject({ date: "2026-09-01T00:00:00.000Z", dateKind: "published" });
  });
});
