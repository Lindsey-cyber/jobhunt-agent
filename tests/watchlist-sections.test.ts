import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { assembleWatchlist, splitSections } from "../scripts/rebuild-watchlist.ts";
import { Watchlist } from "../src/sources/fetch.ts";

const ROOT = join(import.meta.dirname, "..");
const REAL = readFileSync(join(ROOT, "config/watchlist.yaml"), "utf8");
const keys = (text: string) => splitSections(text).flatMap((b) => (b.key ? [b.key] : []));
const section = (text: string, key: string) => splitSections(text).find((b) => b.key === key)?.lines;

describe("watchlist rebuild keeps every section it does not regenerate", () => {
  it("keeps every top-level key of the real file, verbatim, when the company sections are rewritten", () => {
    expect(assembleWatchlist(REAL, {})).toBe(REAL);
    const out = assembleWatchlist(REAL, {
      greenhouse: ["  - { board: x, company: 'X' }"],
      lever: ["  - { board: x, company: 'X' }"],
      ashby: ["  - { board: x, company: 'X' }"],
      workday: ["  - { site: 'https://x.wd1.myworkdayjobs.com/x', company: 'X' }"],
    });
    expect(keys(out)).toEqual(keys(REAL));
    for (const k of ["workdayQueries", "github", "hn", "skipped", "pending", "smartrecruiters", "oracleHcm", "eightfold", "aliases", "aggregators", "amazon", "atlassian", "jibe", "ibm"])
      expect(section(out, k)).toEqual(section(REAL, k));
    expect(() => Watchlist.parse(parse(out))).not.toThrow();
  });
});
