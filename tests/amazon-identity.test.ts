import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Job, JobKey, Sighting } from "../src/domain/job.ts";
import { jobKey } from "../src/discover/identity.ts";
import { mergeRun, rekeyPrior } from "../src/discover/merge.ts";
import { parseAmazon } from "../src/discover/parse.ts";
import { SOURCE_REGISTRY } from "../src/discover/sources.ts";
import type { CandidateFacts } from "../src/discover/triage.ts";

const me: CandidateFacts = { needsSponsorship: true, usCitizen: false, hasPhd: false };
const T0 = "2026-10-28T00:00:00.000Z";
const T1 = "2026-11-02T00:00:00.000Z";

describe("Amazon identity", () => {
  it("keys every amazon.jobs URL form to amazon:<id>", () => {
    for (const u of [
      "https://amazon.jobs/en/jobs/10591841/senior-ml-engineer",
      "https://www.amazon.jobs/en/jobs/10591841/senior-ml-engineer",
      "https://www.amazon.jobs/jobs/10591841/senior-ml-engineer",
      "https://www.amazon.jobs/en/jobs/10591841",
      "https://www.amazon.jobs/en/jobs/10591841/",
      "https://account.amazon.jobs/jobs/10591841/apply",
      "https://account.amazon.jobs/en-US/jobs/10591841/apply?utm_source=x#top",
      "https://AMAZON.JOBS/en/jobs/10591841/x?cmpid=abc",
    ]) expect(jobKey(u)).toBe("amazon:10591841");
  });
  it("does not key non-job amazon.jobs pages or lookalike hosts to an id", () => {
    expect(jobKey("https://www.amazon.jobs/en/search?base_query=ml")).toMatch(/^url:/);
    expect(jobKey("https://www.amazon.jobs/en/jobs/abc/x")).toMatch(/^url:/);
    expect(jobKey("https://notamazon.jobs/en/jobs/123/x")).toMatch(/^url:/);
    expect(jobKey("https://amazon.jobs.evil.com/en/jobs/123/x")).toMatch(/^url:/);
  });
  it("parseAmazon sightings carry the amazon key", () => {
    const [s] = parseAmazon({ jobs: [{ title: "ML Engineer", job_path: "/en/jobs/10591841/ml-engineer", posted_date: "October 28, 2026" }] }, T1);
    expect(s!.key).toBe("amazon:10591841");
  });
});

const job = (url: string, over: Partial<Job> = {}): Job => ({
  key: `url:${url}` as JobKey, company: "Amazon", title: "ML Engineer", location: "Seattle, WA, USA", url, official: false, publishedAt: "", description: "",
  sources: [{ channel: "gmail_linkedin", source: "inbox", url, official: false, date: "", dateKind: "none", firstSeen: T0, lastSeen: T0 }],
  firstSeen: T0, lastSeen: T0, triage: { verdict: "review", rule: "x", reason: "" }, hints: {}, size: "unknown", ...over,
});
const seen = (): Sighting => parseAmazon({ jobs: [{ title: "ML Engineer", job_path: "/en/jobs/10591841/ml-engineer", posted_date: "October 28, 2026", normalized_location: "Seattle, WA, USA", description: "desc" }] }, T1)[0]!;

describe("Amazon re-sightings merge onto old url: entries", () => {
  it("never creates a duplicate for any old key form", () => {
    for (const u of ["https://amazon.jobs/en/jobs/10591841/ml-engineer", "https://www.amazon.jobs/en/jobs/10591841/ml-engineer", "https://www.amazon.jobs/jobs/10591841/ml-engineer", "https://account.amazon.jobs/jobs/10591841/apply"]) {
      const prior = new Map<JobKey, Job>([[`url:${u}` as JobKey, job(u)]]);
      const out = mergeRun(prior, [seen()], me);
      const amazon = [...out.values()].filter((j) => j.company === "Amazon");
      expect(amazon).toHaveLength(1);
      expect(amazon[0]!.key).toBe("amazon:10591841");
      expect(amazon[0]!.official).toBe(true);
      expect(amazon[0]!.firstSeen).toBe(T0);
      expect(amazon[0]!.sources.map((s) => s.channel).sort()).toEqual(["gmail_linkedin", "official_amazon"]);
    }
  });
  it("folds several old entries of one id into one, keeping the earliest firstSeen and every source", () => {
    const a = "https://amazon.jobs/en/jobs/10591841/ml-engineer";
    const b = "https://account.amazon.jobs/jobs/10591841/apply";
    const prior = new Map<JobKey, Job>([
      [`url:${a}` as JobKey, job(a, { description: "long official text", official: true, firstSeen: "2026-10-30T00:00:00.000Z" })],
      [`url:${b}` as JobKey, job(b, { sources: [{ channel: "gmail_indeed", source: "inbox2", url: b, official: false, date: "", dateKind: "none", firstSeen: T0, lastSeen: T0 }] })],
    ]);
    const out = rekeyPrior(prior);
    expect(out.size).toBe(1);
    const j = out.get("amazon:10591841" as JobKey)!;
    expect(j.description).toBe("long official text");
    expect(j.firstSeen).toBe(T0);
    expect(j.sources).toHaveLength(2);
  });
  it("leaves other url keys and unrelated Amazon ids alone", () => {
    const o = "https://example.com/jobs/1";
    const prior = new Map<JobKey, Job>([[`url:${o}` as JobKey, job(o, { company: "Ex" })], [`amazon:5` as JobKey, job("https://www.amazon.jobs/en/jobs/5/x", { key: "amazon:5" as JobKey })]]);
    const out = rekeyPrior(prior);
    expect([...out.keys()].sort()).toEqual([`amazon:5`, `url:${o}`]);
    expect(mergeRun(prior, [], me).size).toBe(2);
  });
});

describe("registry rows render their reasons", () => {
  it("marks YC and VC boards no_api with a reason", () => {
    for (const id of ["yc", "vc_portfolio"]) {
      const r = SOURCE_REGISTRY.find((x) => x.id === id)!;
      expect(r.status).toBe("no_api");
      expect(r.reason).toBeTruthy();
    }
    for (const r of SOURCE_REGISTRY.filter((x) => x.status === "deferred")) expect(r.reason).toBeTruthy();
  });
});

describe("daily discovery runs the new fetchers", () => {
  it("calls fetchSmartRecruiters, fetchOracleHcm and fetchAmazon from src/run/discover.ts", () => {
    const src = readFileSync(join(import.meta.dirname, "../src/run/discover.ts"), "utf8");
    for (const f of ["fetchSmartRecruiters(c, w.workdayQueries", "fetchOracleHcm(o, w.workdayQueries", "fetchAmazon(w.amazon!.queries"]) expect(src).toContain(f);
  });
});
