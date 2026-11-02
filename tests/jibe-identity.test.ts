import { describe, expect, it } from "vitest";
import type { Job, JobKey } from "../src/domain/job.ts";
import { JIBE_HOSTS, jobKey } from "../src/discover/identity.ts";
import { rekeyPrior } from "../src/discover/merge.ts";
import { loadWatchlist } from "../src/sources/fetch.ts";

const T0 = "2026-10-28T00:00:00.000Z";
const T1 = "2026-11-01T00:00:00.000Z";
const KEY = "jibe:careers.amd.com:93894";

const oldRow = (url: string, extra: Partial<Job> = {}): Job => ({
  key: `url:${url}` as JobKey, company: "AMD", title: "Distributed Systems Software Engineer - Collectives", location: "Austin, TX, USA", url, official: false, publishedAt: "", description: "",
  sources: [{ channel: "github_newgrad", source: "https://github.com/x/y", url, official: false, date: "", dateKind: "none", firstSeen: T0, lastSeen: T0 }],
  firstSeen: T0, lastSeen: T0, triage: { verdict: "review", rule: "x", reason: "" }, hints: {}, size: "unknown", ...extra,
});

describe("Jibe posting identity", () => {
  it("keys both AMD URL forms to the same jibe key", () => {
    for (const u of [
      "https://careers.amd.com/jobs/93894?icims=1",
      "https://careers.amd.com/jobs/93894",
      "https://careers.amd.com/jobs/93894?lang=en-us",
      "https://CAREERS.amd.com/jobs/93894/",
      "https://careers.amd.com/careers-home/jobs/93894",
    ]) expect(jobKey(u)).toBe(KEY);
  });

  it("leaves a /jobs/<digits> URL on a host that is not a Jibe host as a plain URL", () => {
    expect(jobKey("https://careers.example.com/jobs/123")).toMatch(/^url:/);
    expect(jobKey("https://careers.example.com/jobs/123?icims=1")).toMatch(/^url:/);
    expect(jobKey("https://careers.amd.com/jobs/93894/slug")).toMatch(/^url:/);
    expect(jobKey("https://careers.amd.com/jobs/abc?icims=1")).toMatch(/^url:/);
  });

  it("every watchlist jibe host is a Jibe host for /jobs/<id>", () => {
    for (const j of loadWatchlist().jibe) expect(JIBE_HOSTS).toContain(j.host);
  });

  it("folds old url: rows for the same AMD id onto one jibe row, with both sources kept", () => {
    const prior = new Map<JobKey, Job>([
      [`url:https://careers.amd.com/jobs/93894?icims=1` as JobKey, oldRow("https://careers.amd.com/jobs/93894?icims=1")],
      [`url:https://careers.amd.com/jobs/93894?lang=en-us` as JobKey, oldRow("https://careers.amd.com/jobs/93894?lang=en-us", { lastSeen: T1, sources: [{ channel: "github_newgrad", source: "https://github.com/z/w", url: "", official: false, date: "", dateKind: "none", firstSeen: T1, lastSeen: T1 }] })],
    ]);
    const out = rekeyPrior(prior);
    expect([...out.keys()]).toEqual([KEY]);
    const job = out.get(KEY as JobKey)!;
    expect(job.key).toBe(KEY);
    expect(job.sources).toHaveLength(2);
    expect(job.firstSeen).toBe(T0);
    expect(job.lastSeen).toBe(T1);
  });

  it("an existing jibe row absorbs an old url: row for the same id", () => {
    const official = oldRow("https://careers.amd.com/jobs/93894?icims=1", { key: KEY as JobKey, official: true, url: "https://careers.amd.com/careers-home/jobs/93894", publishedAt: "2026-10-30T00:00:00.000Z" });
    const prior = new Map<JobKey, Job>([[KEY as JobKey, official], [`url:https://careers.amd.com/jobs/93894?icims=1` as JobKey, oldRow("https://careers.amd.com/jobs/93894?icims=1")]]);
    const out = rekeyPrior(prior);
    expect([...out.keys()]).toEqual([KEY]);
    expect(out.get(KEY as JobKey)!.official).toBe(true);
  });

  it("does not move a non-Jibe /jobs/123 url: row", () => {
    const u = "https://careers.example.com/jobs/123";
    const out = rekeyPrior(new Map<JobKey, Job>([[`url:${u}` as JobKey, oldRow(u)]]));
    expect([...out.keys()]).toEqual([`url:${u}`]);
  });
});
