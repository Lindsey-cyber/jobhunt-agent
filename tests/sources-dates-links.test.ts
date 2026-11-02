import { describe, expect, it } from "vitest";
import type { JobKey, Sighting } from "../src/domain/job.ts";
import { locationsCompatible, mergeRun, US_STATES } from "../src/discover/merge.ts";
import { parseWorkdayDetail, parseWorkdayPostedOn } from "../src/discover/parse.ts";
import { SOURCE_REGISTRY } from "../src/discover/sources.ts";
import type { CandidateFacts } from "../src/discover/triage.ts";

const me: CandidateFacts = { needsSponsorship: true, usCitizen: false, hasPhd: false };
const NOW = "2026-11-02T15:30:00.000Z";

describe("source registry", () => {
  it("has one row for each channel the candidate asked for, with ids unique", () => {
    const ids = SOURCE_REGISTRY.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["official_greenhouse", "official_lever", "official_ashby", "official_workday", "official_smartrecruiters", "official_oracle_hcm", "official_icims", "official_workable", "official_amazon", "official_career_pages", "github_newgrad", "gmail_alerts", "direct_job_boards", "yc", "wellfound", "vc_portfolio", "hn_hiring", "ai_ml_boards", "network", "brave_tavily"]) {
      expect(ids).toContain(id);
    }
  });

  it("marks no_api only for sources with no public API, and never calls an unbuilt API source no_api", () => {
    const status = Object.fromEntries(SOURCE_REGISTRY.map((r) => [r.id, r.status]));
    expect(status.direct_job_boards).toBe("no_api");
    expect(status.wellfound).toBe("no_api");
    expect(status.brave_tavily).toBe("deferred");
    expect(status.vc_portfolio).toBe("no_api");
    expect(status.official_workday).toBe("live");
  });
});

describe("Workday relative dates", () => {
  it("resolves Posted Today / Yesterday / N Days Ago to a UTC day relative to fetch time", () => {
    expect(parseWorkdayPostedOn("Posted Today", NOW)).toEqual({ date: "2026-11-02T00:00:00.000Z", dateKind: "relative_posted" });
    expect(parseWorkdayPostedOn("Posted Yesterday", NOW)).toEqual({ date: "2026-11-01T00:00:00.000Z", dateKind: "relative_posted" });
    expect(parseWorkdayPostedOn("Posted 3 Days Ago", NOW)).toEqual({ date: "2026-10-30T00:00:00.000Z", dateKind: "relative_posted" });
    expect(parseWorkdayPostedOn("Posted 1 Day Ago", NOW)).toEqual({ date: "2026-11-01T00:00:00.000Z", dateKind: "relative_posted" });
    expect(parseWorkdayPostedOn("Posted 5 Days Ago", "2026-11-03T00:30:00.000Z")?.date).toBe("2026-10-29T00:00:00.000Z");
  });

  it("keeps 30+ as an upper bound, not a publication date", () => {
    expect(parseWorkdayPostedOn("Posted 30+ Days Ago", NOW)).toEqual({ date: "2026-10-03T00:00:00.000Z", dateKind: "posted_before" });
  });

  it("returns nothing for text it does not understand", () => {
    expect(parseWorkdayPostedOn("", NOW)).toBeUndefined();
    expect(parseWorkdayPostedOn(undefined, NOW)).toBeUndefined();
    expect(parseWorkdayPostedOn("Posted last week", NOW)).toBeUndefined();
    expect(parseWorkdayPostedOn("Posted Today", "not a date")).toBeUndefined();
  });

  const detail = { jobPostingInfo: { title: "ML Engineer", startDate: "2026-12-01", location: "Plano, TX", externalUrl: "https://x.wd1.myworkdayjobs.com/Ext/job/Plano-TX/ML-Engineer_REQ_1" } };

  it("uses the list's postedOn over the start date and falls back to the start date", () => {
    expect(parseWorkdayDetail(detail, "https://x.wd1.myworkdayjobs.com/Ext", "/job/a", "X", NOW, "Posted 2 Days Ago")).toMatchObject({ date: "2026-10-31T00:00:00.000Z", dateKind: "relative_posted" });
    expect(parseWorkdayDetail({ jobPostingInfo: { ...detail.jobPostingInfo, postedOn: "Posted Today" } }, "https://x.wd1.myworkdayjobs.com/Ext", "/job/a", "X", NOW)).toMatchObject({ dateKind: "relative_posted" });
    expect(parseWorkdayDetail(detail, "https://x.wd1.myworkdayjobs.com/Ext", "/job/a", "X", NOW)).toMatchObject({ date: "2026-12-01T00:00:00.000Z", dateKind: "start_date" });
  });

  it("counts a relative date as published but a 30+ bound as unknown, and keeps the recorded date within a day", () => {
    const wd = (postedOn: string, seenAt: string) => parseWorkdayDetail(detail, "https://x.wd1.myworkdayjobs.com/Ext", "/job/a", "X", seenAt, postedOn)!;
    const key = wd("Posted Today", NOW).key;
    const first = mergeRun(new Map(), [wd("Posted 3 Days Ago", NOW)], me);
    expect(first.get(key)!.publishedAt).toBe("2026-10-30T00:00:00.000Z");
    const next = mergeRun(first, [wd("Posted 4 Days Ago", "2026-11-03T15:30:00.000Z")], me);
    expect(next.get(key)!.publishedAt).toBe("2026-10-30T00:00:00.000Z");
    const old = mergeRun(new Map(), [wd("Posted 30+ Days Ago", NOW)], me);
    expect(old.get(key)!.publishedAt).toBe("");
  });
});

describe("alert-only postings", () => {
  const base = { seenAt: NOW, description: "", date: NOW, hints: {} };
  const official = (id: number, over: Partial<Sighting> = {}): Sighting => ({
    ...base,
    channel: "official_greenhouse",
    source: "https://job-boards.greenhouse.io/acme",
    url: `https://job-boards.greenhouse.io/acme/jobs/${id}`,
    key: `greenhouse:${id}` as JobKey,
    official: true,
    company: "Acme, Inc.",
    title: "Machine Learning Engineer, New Grad",
    location: "New York, NY",
    dateKind: "published",
    ...over,
  });
  const alert = (id: number, over: Partial<Sighting> = {}): Sighting => ({
    ...base,
    channel: "gmail_linkedin",
    source: "gmail:1",
    url: `https://www.linkedin.com/jobs/view/${id}`,
    key: `linkedin:${id}` as JobKey,
    official: false,
    company: "Acme",
    title: "Machine Learning Engineer - New Grad",
    location: "New York, NY",
    dateKind: "email_received",
    ...over,
  });

  it("links to the one official posting with the same company, title and location, without merging", () => {
    const jobs = mergeRun(new Map(), [official(1), alert(900001)], me);
    expect(jobs.size).toBe(2);
    const a = jobs.get("linkedin:900001" as JobKey)!;
    expect(a.officialLink).toEqual({ key: "greenhouse:1", url: "https://job-boards.greenhouse.io/acme/jobs/1", basis: "company+title+location" });
    expect(a.hints.needsOfficialPage).toBe(false);
    expect(a.official).toBe(false);
    expect(jobs.get("greenhouse:1" as JobKey)!.officialLink).toBeUndefined();
  });

  it("does not link when two official postings fit, and marks it as needing an official page", () => {
    const jobs = mergeRun(new Map(), [official(1), official(2), alert(900002)], me);
    const a = jobs.get("linkedin:900002" as JobKey)!;
    expect(a.officialLink).toBeUndefined();
    expect(a.hints.needsOfficialPage).toBe(true);
  });

  it("uses location to tell same-title postings apart", () => {
    const jobs = mergeRun(new Map(), [official(1), official(2, { location: "Austin, TX" }), alert(900003, { location: "Austin, TX" })], me);
    expect(jobs.get("linkedin:900003" as JobKey)!.officialLink?.key).toBe("greenhouse:2");
  });

  it("does not link a different title, a different company or an incompatible location", () => {
    const jobs = mergeRun(new Map(), [official(1), alert(900004, { title: "Senior Machine Learning Engineer" }), alert(900005, { company: "Acme Robotics" }), alert(900006, { location: "Seattle, WA" }), alert(900007, { location: "" })], me);
    for (const id of [900004, 900005, 900006, 900007]) {
      const a = jobs.get(`linkedin:${id}` as JobKey)!;
      expect(a.officialLink).toBeUndefined();
      expect(a.hints.needsOfficialPage).toBe(true);
    }
  });

  it("only links to official sources and never touches a job that has an official source", () => {
    const github = { ...official(5), channel: "github_newgrad" as const, official: false, key: "url:x" as JobKey, url: "https://x.example/5" };
    const jobs = mergeRun(new Map(), [github, alert(900008)], me);
    expect(jobs.get("linkedin:900008" as JobKey)!.officialLink).toBeUndefined();
    expect(jobs.get("url:x" as JobKey)!.hints.needsOfficialPage).toBeUndefined();
  });

  it("drops a stale link when the official posting is gone", () => {
    const first = mergeRun(new Map(), [official(1), alert(900009)], me);
    const gone = new Map(first);
    gone.delete("greenhouse:1" as JobKey);
    const second = mergeRun(gone, [alert(900009, { seenAt: "2026-11-03T00:00:00.000Z" })], me);
    expect(second.get("linkedin:900009" as JobKey)!.officialLink).toBeUndefined();
    expect(second.get("linkedin:900009" as JobKey)!.hints.needsOfficialPage).toBe(true);
  });

  it("matches locations by city, remote, and state when both name one", () => {
    expect(locationsCompatible("New York, NY", "New York, NY; Boston, MA")).toBe(true);
    expect(locationsCompatible("New York, NY", "Boston, MA")).toBe(false);
    expect(locationsCompatible("Remote", "Remote - US")).toBe(true);
    expect(locationsCompatible("Portland, OR", "Portland, ME")).toBe(false);
    expect(locationsCompatible("", "New York, NY")).toBe(false);
    expect(locationsCompatible("New York, NY", "")).toBe(false);
  });

  it("never links San Francisco to South San Francisco, and reads states both ways", () => {
    expect(locationsCompatible("San Francisco, CA", "Austin, Texas; South San Francisco, California")).toBe(false);
    expect(locationsCompatible("San Francisco, CA", "San Francisco, California")).toBe(true);
    expect(locationsCompatible("San Francisco, CA", "South San Francisco, California, United States")).toBe(false);
    expect(locationsCompatible("Austin, TX", "Austin, Texas, United States")).toBe(true);
    expect(locationsCompatible("Austin, Texas", "Austin, TX")).toBe(true);
    expect(locationsCompatible("Austin, TX", "Dallas, Texas")).toBe(false);
    expect(locationsCompatible("San Francisco, CA", "San Francisco")).toBe(false);
  });

  it("accepts a city written without its state, and New York City as New York", () => {
    expect(locationsCompatible("New York", "New York City, NY")).toBe(true);
    expect(locationsCompatible("Austin", "Austin, Texas, United States")).toBe(true);
  });

  it("links a remote line only to remote-only official text", () => {
    expect(locationsCompatible("Remote", "Seattle, WA")).toBe(false);
    expect(locationsCompatible("Remote", "Remote - US")).toBe(true);
    expect(locationsCompatible("Remote", "Austin, TX (Remote)")).toBe(false);
    expect(locationsCompatible("Seattle, WA", "Remote - US")).toBe(false);
  });

  it("maps all 50 states and DC between code and name", () => {
    expect(US_STATES).toHaveLength(51);
    for (const [code, name] of US_STATES) {
      expect(locationsCompatible(`Springfield, ${code}`, `Springfield, ${name}`)).toBe(true);
      expect(locationsCompatible(`Springfield, ${name}`, `Springfield, ${code}`)).toBe(true);
      expect(locationsCompatible(`Springfield, ${code}`, `Springfield, ${US_STATES.find(([c]) => c !== code)![1]}`)).toBe(false);
    }
  });
});
