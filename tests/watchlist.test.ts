import { describe, expect, it } from "vitest";
import { loadWatchlist } from "../src/sources/fetch.ts";
import { bandOf, decide, isMlTitle, locate, renderEntry, slugGuesses, sizeOf } from "../scripts/rebuild-watchlist.ts";

describe("watchlist rebuild helpers", () => {
  it("bands H-1B filings: large >= 200, mid 20-199, small < 20, unknown when not looked up", () => {
    expect([bandOf(200), bandOf(199), bandOf(20), bandOf(19), bandOf(0), bandOf(undefined)]).toEqual(["large", "mid", "mid", "small", "small", "unknown"]);
  });

  it("writes a size the loader accepts: medium_large only for large and mid", () => {
    expect([sizeOf("large"), sizeOf("mid"), sizeOf("small"), sizeOf("unknown")]).toEqual(["medium_large", "medium_large", "unknown", "unknown"]);
  });

  it("knows ML, AI and data-science titles", () => {
    expect(isMlTitle("Machine Learning Engineer, New Grad")).toBe(true);
    expect(isMlTitle("Data Scientist")).toBe(true);
    expect(isMlTitle("Account Executive")).toBe(false);
  });

  const base = { band: "small" as const, excluded: false, everMatch: false, recentMatch: false, mlTitle: false };
  it("keeps on a recent match or on large/mid with an ML title, drops only with no match, no ML title and not large/mid", () => {
    expect(decide({ ...base, recentMatch: true, everMatch: true }).keep).toBe(true);
    expect(decide({ ...base, band: "mid", mlTitle: true }).keep).toBe(true);
    expect(decide(base)).toEqual({ keep: false, why: "no-match-no-ml-small" });
    expect(decide({ ...base, band: "large" }).keep).toBe(true);
    expect(decide({ ...base, mlTitle: true }).keep).toBe(true);
    expect(decide({ ...base, everMatch: true }).keep).toBe(true);
    // A lookup that failed is not proof of a small employer.
    expect(decide({ ...base, band: "unknown" }).keep).toBe(true);
  });

  it("always drops excluded companies", () => {
    expect(decide({ ...base, band: "large", recentMatch: true, excluded: true })).toEqual({ keep: false, why: "excluded" });
  });

  it("finds the board a job URL belongs to", () => {
    expect(locate("https://job-boards.greenhouse.io/stripe/jobs/123")).toEqual({ kind: "greenhouse", board: "stripe" });
    expect(locate("https://jobs.lever.co/spotify/abc")).toEqual({ kind: "lever", board: "spotify" });
    expect(locate("https://jobs.ashbyhq.com/ramp/abc")).toEqual({ kind: "ashby", board: "ramp" });
    expect(locate("https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/x")).toEqual({ kind: "workday", site: "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite" });
    expect(locate("https://careers-foo.icims.com/jobs/1/x/job")?.ats).toBe("iCIMS");
    expect(locate("https://example.com/jobs/1")).toBeUndefined();
  });

  it("guesses board slugs from a company name", () => {
    expect(slugGuesses("Stripe, Inc.")).toContain("stripe");
  });

  it("renders an entry the loader reads back", () => {
    expect(renderEntry({ kind: "greenhouse", board: "stripe", company: "Stripe", band: "large", filings: 900 })).toBe("  - { board: stripe, company: 'Stripe', size: medium_large, band: large, h1b: 900 }");
    expect(renderEntry({ kind: "workday", site: "https://a.wd1.myworkdayjobs.com/x", company: "O'Neil", band: "unknown" })).toContain("company: 'O''Neil', size: unknown, band: unknown }");
  });
});

describe("config/watchlist.yaml", () => {
  // A numeric board name (YAML reads it as a number) once broke jh daily before any fetch ran.
  it("parses, with unique Greenhouse boards", () => {
    const w = loadWatchlist();
    const boards = w.greenhouse.map((g) => g.board.toLowerCase());
    expect(new Set(boards).size).toBe(boards.length);
  });
});
