import { describe, expect, it } from "vitest";
import type { Job, JobKey } from "../src/domain/job.ts";
import { jobKey } from "../src/discover/identity.ts";
import { mergeRun } from "../src/discover/merge.ts";
import { parseAtlassian } from "../src/discover/parse.ts";
import type { CandidateFacts } from "../src/discover/triage.ts";

const me: CandidateFacts = { needsSponsorship: true, usCitizen: false, hasPhd: false };
const T0 = "2026-10-28T00:00:00.000Z";
const T1 = "2026-11-02T00:00:00.000Z";
const KEY = "icims:careers-atlassian.icims.com:4321";

describe("iCIMS identity", () => {
  it("keys every iCIMS portal URL form to icims:<host>:<id>", () => {
    for (const u of [
      "https://careers-atlassian.icims.com/jobs/4321/job?mode=apply",
      "https://careers-atlassian.icims.com/jobs/4321/senior-engineer/job",
      "https://careers-atlassian.icims.com/jobs/4321/job?mobile=true&needsRedirect=false",
      "https://careers-atlassian.icims.com/jobs/4321",
      "https://careers-atlassian.icims.com/jobs/4321/",
      "https://careers-atlassian.icims.com/jobs/4321/senior%20engineer%2c-campus/job?lang=en-us",
      "https://careers-atlassian.icims.com/en-US/jobs/4321/senior-engineer/job",
      "http://CAREERS-ATLASSIAN.icims.com/jobs/4321/senior-engineer/job",
    ]) expect(jobKey(u)).toBe(KEY);
    expect(jobKey("https://careers-other.icims.com/jobs/4321/job")).toBe("icims:careers-other.icims.com:4321");
  });

  it("does not key an iCIMS page without a numeric job id to an id", () => {
    expect(jobKey("https://careers-atlassian.icims.com/jobs/intro?hashed=1")).toMatch(/^url:/);
    expect(jobKey("https://careers-atlassian.icims.com/jobs/search")).toMatch(/^url:/);
  });

  it("folds old url: rows onto their icims key, and a fresh Atlassian sighting for the same id adds no second row", () => {
    const u1 = "https://careers-atlassian.icims.com/jobs/4321/senior-engineer/job";
    const u2 = "https://careers-atlassian.icims.com/jobs/4321/job?mobile=true";
    const old = (u: string): Job => ({
      key: `url:${u}` as JobKey, company: "Atlassian", title: "Senior Engineer", location: "San Francisco, CA, USA", url: u, official: false, publishedAt: "", description: "",
      sources: [{ channel: "github_newgrad", source: "https://github.com/x/y", url: u, official: false, date: "", dateKind: "none", firstSeen: T0, lastSeen: T0 }],
      firstSeen: T0, lastSeen: T0, triage: { verdict: "review", rule: "x", reason: "" }, hints: {}, size: "unknown",
    });
    const prior = new Map<JobKey, Job>([[`url:${u1}` as JobKey, old(u1)], [`url:${u2}` as JobKey, old(u2)]]);
    const fresh = parseAtlassian([{ title: "Senior Engineer", portalJobPost: { portalUrl: `${u1.replace("/senior-engineer/job", "/job")}?mode=apply`, updatedDate: "2026-11-01 10:00 AM" } } as never], T1);
    const out = mergeRun(prior, fresh, me);
    expect([...out.keys()].filter((k) => k.includes("icims"))).toEqual([KEY]);
    const job = out.get(KEY as JobKey)!;
    expect(job.sources.map((s) => s.channel).sort()).toEqual(["github_newgrad", "official_atlassian"]);
    expect(job.firstSeen).toBe(T0);
  });
});
