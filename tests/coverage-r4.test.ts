import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fits, isAggregator, normCompany, parseListTable, sampleOf } from "../src/discover/coverage.ts";
import { requireIndependent, SAMPLE_LISTS, watchlistUrls } from "../src/sources/coverage.ts";

const NOW = new Date("2026-11-02T12:00:00Z");
const POLICY = { excludeSeniorTitles: true, excludeCompanies: [], excludeTitles: [] } as unknown as Parameters<typeof fits>[1];
const md = readFileSync("tests/fixtures/jobright-engineering-sample.md", "utf8");
const rows = parseListTable("jobright-ai/2026-Engineering-New-Grad", md);

describe("jobright Engineering list (saved sample)", () => {
  it("reads every table row, skipping the header, the divider and prose", () => {
    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject({ company: "SpaceX Super Intelligence", title: "Model Engineer, Post-Training & RL", location: "Palo Alto, CA, United States", date: "Nov 02" });
  });
  it("takes the posting link from the title cell (the work-model column has none)", () => {
    expect(rows[0]!.url).toMatch(/^https:\/\/jobright\.ai\/jobs\/info\/6a420a38b526a24fc31325d8/);
  });
  it("gives a continuation row (arrow in the company cell) the company above it", () => {
    expect(rows[2]).toMatchObject({ company: "Babcock International Group", location: "Rosyth, Scotland, United Kingdom" });
    expect(rows[5]).toMatchObject({ company: "IBM", title: "Entry Level AI Software Engineer", location: "Durham, NC, United States" });
  });
  it("keeps ML/data rows in the US and drops overseas, intern and out-of-date ones", () => {
    const fit = rows.filter((r) => fits(r, POLICY, NOW)).map((r) => `${r.company}: ${r.title}`);
    expect(fit).toEqual(expect.arrayContaining(["IBM: Entry Level AI Software Engineer", "Atlassian: Data Engineer, 2027 Graduate U.S"]));
    expect(fit.some((f) => f.startsWith("Babcock"))).toBe(false);
    expect(fit.some((f) => f.includes("Intern"))).toBe(false);
  });
  it("counts the two IBM postings with the same title once", () => {
    const ibm = sampleOf(rows.filter((r) => r.company === "IBM"), 10);
    expect(ibm).toHaveLength(1);
  });
  it("leaves out rows of a listed aggregator", () => {
    expect(isAggregator("Example Corp", ["example corp"], normCompany)).toBe(true);
    expect(isAggregator("IBM", ["example corp"], normCompany)).toBe(false);
  });
});

describe("sample lists against the real watchlist", () => {
  it("no list the coverage command samples is fetched by the pipeline", () => {
    expect(() => requireIndependent(SAMPLE_LISTS, watchlistUrls())).not.toThrow();
  });
  it("includes the Engineering list, and lists no repo twice", () => {
    const names = SAMPLE_LISTS.map((l) => l.name.toLowerCase());
    expect(names).toContain("jobright-ai/2026-engineering-new-grad");
    expect(new Set(names).size).toBe(names.length);
  });
});
