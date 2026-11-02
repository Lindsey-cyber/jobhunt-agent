import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stageGates } from "../src/discover/gates.ts";
import { readCoverage } from "../src/store/coverage.ts";

const dirWith = (files: Record<string, unknown>) => {
  const d = mkdtempSync(join(tmpdir(), "jh-cov-"));
  mkdirSync(join(d, "coverage"));
  for (const [f, v] of Object.entries(files)) writeFileSync(join(d, "coverage", f), JSON.stringify(v));
  return d;
};
const ok = { date: "2026-10-30", n: 50, inCatalog: 48, inCatalogNotRejected: 46 };

describe("coverage file validation", () => {
  it("accepts a consistent file", () => expect(readCoverage(dirWith({ "2026-10-30.json": ok })).coverage).toEqual(ok));
  it("accepts the optional staleExcluded, and rejects a bad one", () => {
    const withStale = { ...ok, staleExcluded: 7 };
    expect(readCoverage(dirWith({ "2026-10-30.json": withStale })).coverage).toEqual(withStale);
    for (const bad of [-1, 1.5, "7"]) expect(readCoverage(dirWith({ "2026-10-30.json": { ...ok, staleExcluded: bad } })).problem).toContain("staleExcluded");
  });
  it.each([
    ["inCatalog > n", { ...ok, inCatalog: 51 }],
    ["inCatalogNotRejected > inCatalog", { ...ok, inCatalogNotRejected: 49 }],
    ["negative count", { ...ok, inCatalogNotRejected: -1 }],
    ["non-integer n", { ...ok, n: 50.5 }],
  ])("rejects %s and says why", (_n, bad) => {
    const r = readCoverage(dirWith({ "2026-10-30.json": bad }));
    expect(r.coverage).toBeUndefined();
    expect(r.problem).toContain("被拒绝");
  });
  it("a rejected newest file does not fall back to an older good one, and the gate fails with the reason", () => {
    const r = readCoverage(dirWith({ "2026-10-20.json": ok, "2026-10-30.json": { ...ok, inCatalog: 99 } }));
    expect(r.coverage).toBeUndefined();
    const g = stageGates({ coverage: r.coverage, coverageProblem: r.problem, registry: [{ status: "live" }], today: "2026-11-02", matches: [] });
    expect(g["1a"].checks[0]).toMatchObject({ pass: false, value: expect.stringContaining("被拒绝") });
  });
});
