import { describe, expect, it } from "vitest";
import { causeOf, fits, indexCatalog, match, notIndependent, parseListTable, report, sampleOf, summarize, urlsIn, type Judged, type SampleRow } from "../src/discover/coverage.ts";
import type { Job, JobKey } from "../src/domain/job.ts";

const job = (o: Partial<Job> & Pick<Job, "key" | "company" | "title">): Job =>
  ({ location: "Remote, US", url: `https://x.test/${o.key}`, official: false, publishedAt: "", description: "", sources: [], firstSeen: "", lastSeen: "", triage: { verdict: "match", rule: "role.match", reason: "" }, hints: {}, size: "unknown", ...o }) as Job;
const row = (company: string, title: string, o: Partial<SampleRow> = {}): SampleRow => ({ company, title, location: "Austin, TX", date: "Nov 01", list: "L", ...o });
const NOW = new Date("2026-11-02T12:00:00Z");
const POLICY = { excludeCompanies: ["Google"], excludeTitles: ["analytics engineer"], excludeSeniorTitles: true };

describe("independence", () => {
  const watch = urlsIn("- { name: SimplifyJobs/New-Grad-Positions, url: 'https://github.com/SimplifyJobs/New-Grad-Positions', raw: 'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/x.json' }");
  it("refuses a source whose repo the watchlist fetches, in any URL form", () => {
    expect(notIndependent(["https://raw.githubusercontent.com/simplifyjobs/new-grad-positions/main/README.md"], watch)).toHaveLength(1);
    expect(notIndependent(["https://github.com/SimplifyJobs/New-Grad-Positions"], watch)).toHaveLength(1);
  });
  it("accepts a different repo by the same owner", () => {
    expect(notIndependent(["https://github.com/SimplifyJobs/Other"], watch)).toEqual([]);
  });
});

describe("list parsing and the sample filter", () => {
  const md = [
    "| Company | Job Title | Location | Work Model | Date Posted |",
    "| --- | --- | --- | --- | --- |",
    "| **[Acme](https://acme.test)** | **[ML Engineer, New Grad](https://jobright.ai/jobs/info/1?utm=1)** | Austin, TX, United States | Hybrid | Nov 01 |",
    "| ↳ | **[Data Scientist I](https://jobright.ai/jobs/info/2)** | Remote, United States | Remote | Sep 01 |",
    "| Beta | Software Engineer | NY | x | Nov 01 |",
  ].join("\n");
  const rows = parseListTable("L", md);
  it("reads company, title, location, link and date, carrying a company over a ↳ row", () => {
    expect(rows[0]).toMatchObject({ company: "Acme", title: "ML Engineer, New Grad", date: "Nov 01", url: "https://jobright.ai/jobs/info/1?utm=1" });
    expect(rows[1]!.company).toBe("Acme");
  });
  it("keeps only fresh, US, ML-titled, policy-clean postings", () => {
    expect(fits(rows[0]!, POLICY, NOW)).toBe(true);
    expect(fits(rows[1]!, POLICY, NOW)).toBe(false); // 62 days old
    expect(fits(rows[2]!, POLICY, NOW)).toBe(false); // not an ML title
    expect(fits(row("Google DeepMind", "ML Engineer"), POLICY, NOW)).toBe(false); // excluded company
    expect(fits(row("Acme", "Senior ML Engineer"), POLICY, NOW)).toBe(false);
    expect(fits(row("Acme", "Analytics Engineer, ML"), POLICY, NOW)).toBe(false);
    expect(fits(row("Acme", "ML Engineer", { location: "London, United Kingdom" }), POLICY, NOW)).toBe(false);
  });
  it("de-duplicates and caps deterministically", () => {
    const many = Array.from({ length: 10 }, (_, i) => row(`C${i}`, "ML Engineer"));
    expect(sampleOf([...many, many[0]!], 100)).toHaveLength(10);
    expect(sampleOf(many, 4)).toHaveLength(4);
    expect(sampleOf(many, 4)).toEqual(sampleOf([...many].reverse(), 4));
  });
});

describe("matching", () => {
  const gh = job({ key: "greenhouse:123" as JobKey, company: "Acme Inc.", title: "Machine Learning Engineer (New Grad 2027)", official: true });
  const idx = indexCatalog([gh, job({ key: "url:https://x.test/senior" as JobKey, company: "Beta", title: "Senior ML Engineer" })]);
  it("matches by JobKey when the list gives an ATS URL, even if the title differs", () => {
    expect(match(row("Other name", "Totally different", { url: "https://boards.greenhouse.io/acme/jobs/123?gh_src=x" }), idx)).toMatchObject({ how: "key" });
  });
  it("matches by normalized company and title, and by a near title", () => {
    expect(match(row("Acme", "Machine Learning Engineer"), idx)).toMatchObject({ how: "title" });
    expect(match(row("ACME", "Machine Learning Engineer II"), idx)?.how).toBe("fuzzy");
    expect(match(row("Acme", "Data Engineer"), idx)).toBeUndefined();
  });
  it("never counts a senior catalog row as the entry-level posting", () => {
    expect(match(row("Beta", "ML Engineer"), idx)).toBeUndefined();
  });
});

describe("causes", () => {
  const idx = indexCatalog([
    job({ key: "greenhouse:1" as JobKey, company: "Acme", title: "ML Engineer", official: true }),
    job({ key: "greenhouse:2" as JobKey, company: "Acme", title: "Data Scientist", triage: { verdict: "reject", rule: "role.non_engineering", reason: "" } }),
  ]);
  const cause = (r: SampleRow, boards = [] as Parameters<typeof causeOf>[3]) => causeOf(r, match(r, idx), idx, boards);
  it("is undefined for a posting that is in the catalog and not rejected", () => {
    expect(cause(row("Acme", "ML Engineer"))).toBeUndefined();
  });
  it("names the triage rule for a posting the rules rejected", () => {
    expect(cause(row("Acme", "Data Scientist"))).toBe("filtered by triage rule role.non_engineering");
  });
  it("says the company is not on the watchlist", () => {
    expect(cause(row("Nobody", "ML Engineer"))).toBe("company not on watchlist");
  });
  it("names the ATS when a watched company's posting was not fetched", () => {
    expect(cause(row("Acme", "Vision Engineer"), [{ ats: "workday" }])).toBe("watched company, posting not fetched (workday/greenhouse)");
    expect(cause(row("Acme", "Vision Engineer"), [{ ats: "greenhouse", titles: ["Vision Engineer"] }])).toBe("watched company, posting not fetched (greenhouse)");
  });
  it("calls a list entry stale when the official board no longer lists it", () => {
    expect(cause(row("Acme", "Vision Engineer"), [{ ats: "greenhouse", titles: ["Chef"] }])).toMatch(/^stale list entry/);
  });
  it("does not call it stale when one of the company's boards cannot be checked", () => {
    expect(cause(row("Acme", "Vision Engineer"), [{ ats: "greenhouse", titles: ["Chef"] }, { ats: "workday" }])).toMatch(/^watched company/);
  });
});

describe("the coverage file", () => {
  const idx = indexCatalog([
    job({ key: "greenhouse:1" as JobKey, company: "Acme", title: "ML Engineer" }),
    job({ key: "greenhouse:2" as JobKey, company: "Acme", title: "Data Scientist", triage: { verdict: "reject", rule: "role.non_engineering", reason: "" } }),
  ]);
  const judged: Judged[] = [row("Acme", "ML Engineer"), row("Acme", "Data Scientist"), row("Nobody", "AI Engineer", { url: "https://n.test/j" })].map((r) => {
    const found = match(r, idx);
    return { row: r, found, cause: causeOf(r, found, idx, []) };
  });
  const r = report("2026-11-02", ["L"], judged);
  it("has exactly the tracker's fields and counts", () => {
    expect(Object.keys(r).sort()).toEqual(["date", "inCatalog", "inCatalogNotRejected", "misses", "n", "sources"]);
    expect([r.n, r.inCatalog, r.inCatalogNotRejected]).toEqual([3, 2, 1]);
    expect(r.misses.map((m) => Object.keys(m).sort())).toEqual([["cause", "company", "title", "url"], ["cause", "company", "title", "url"]]);
    expect(r.misses[1]).toMatchObject({ company: "Nobody", url: "https://n.test/j", cause: "company not on watchlist" });
  });
  it("summarizes in one paragraph", () => {
    expect(summarize(r)).toContain("2/3 sampled postings are in the catalog");
  });
});
