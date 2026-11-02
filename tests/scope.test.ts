import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inScopeTitle, ROLE, triage } from "../src/discover/triage.ts";
import { loadWatchlist } from "../src/sources/fetch.ts";

afterEach(() => vi.unstubAllGlobals());

describe("title scope shared by triage and every fetcher", () => {
  const kept = ["Data Scientist", "GE Vernova Data Scientist", "Biostatistician I", "Statistician", "Statistical Analyst", "AI Data Analyst", "Machine Learning Analyst", "Quantitative Researcher", "Deep Learning Engineer", "Data Engineer"];
  const dropped = ["Account Executive", "Financial Analyst", "Data Entry Clerk", "Scientist, Chemistry", "", "Business Analyst"];
  it.each(kept)("keeps %s", (t) => expect(inScopeTitle(t)).toBe(true));
  it.each(dropped)("drops %j", (t) => expect(inScopeTitle(t)).toBe(false));
  it("is never narrower than triage: a title triage does not reject as out of scope passes", () => {
    const me = { schools: [] } as never;
    for (const title of [...kept, ...dropped]) {
      const out = triage({ title, location: "Austin, TX", description: "", official: true, hints: {} }, me).rule === "role.out_of_scope";
      expect(inScopeTitle(title), title).toBe(!out);
    }
  });
  it("includes everything ROLE matches", () => expect(inScopeTitle("Senior Recommendation Systems Engineer") || !ROLE.test("Senior Recommendation Systems Engineer")).toBe(true));
});

describe("structure: fetchers share one title scope", () => {
  const dir = join(import.meta.dirname, "..", "src", "sources");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  it("no file in src/sources uses ROLE directly", () => {
    expect(files.filter((f) => /\bROLE\b/.test(readFileSync(join(dir, f), "utf8")))).toEqual([]);
  });
  it("no fetcher defines its own title regex", () => {
    const own = files.flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter((l) => /\b\w*(?:TITLE|ROLE|SCOPE)\w*\s*=\s*(?:\/|new RegExp)/i.test(l) || /data scien|statistician/i.test(l)).map((l) => `${f}: ${l.trim()}`));
    expect(own).toEqual([]);
  });
  it("fetch.ts filters titles through inScopeTitle", () => expect(readFileSync(join(dir, "fetch.ts"), "utf8")).toMatch(/inScopeTitle\(/));
});
