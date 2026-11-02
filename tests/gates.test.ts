import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isDated, stageGates, type GateInput } from "../src/discover/gates.ts";
import type { DateKind } from "../src/domain/job.ts";

const dated = (n: number, of: number) => Array.from({ length: of }, (_, i) => ({ publishedAt: i < n ? "2026-10-30" : "" }));
const good: GateInput = {
  coverage: { date: "2026-10-26", n: 50, inCatalog: 48, inCatalogNotRejected: 46 },
  registry: [{ status: "live" }, { status: "no_api" }],
  today: "2026-11-02",
  matches: dated(9, 10),
  audit: { falseMatchRate: 0.1, missRate: 0.1, matchJudged: 15, rejectJudged: 15 },
};
const fails = (i: GateInput, g: "1a" | "1b" | "1c") => stageGates(i)[g].checks.filter((c) => !c.pass).map((c) => c.name);

describe("stage gates", () => {
  it("passes exactly on every boundary", () => {
    const g = stageGates(good);
    expect(g["1a"].pass && g["1b"].pass && g["1c"].pass).toBe(true);
  });

  it("1a: coverage must be at most 7 days old", () => {
    expect(fails({ ...good, coverage: { ...good.coverage!, date: "2026-10-25" } }, "1a")).toHaveLength(1);
    expect(fails({ ...good, coverage: { ...good.coverage!, date: "2026-11-03" } }, "1a")).toHaveLength(1);
  });
  it("1a: n at least 50 and in-catalog at least 95%", () => {
    expect(fails({ ...good, coverage: { ...good.coverage!, n: 49, inCatalog: 47 } }, "1a")).toHaveLength(1);
    expect(fails({ ...good, coverage: { ...good.coverage!, inCatalog: 47 } }, "1a")).toHaveLength(1);
  });
  it("1a: the registry must exist and have no not_built", () => {
    expect(stageGates({ ...good, registry: undefined })["1a"].checks.find((c) => !c.pass)?.value).toBe("来源登记表未建");
    expect(fails({ ...good, registry: [{ status: "not_built" }] }, "1a")).toHaveLength(1);
    expect(fails({ ...good, registry: [] }, "1a")).toHaveLength(1);
  });
  it("1a: at least 90% of matches dated", () => {
    expect(fails({ ...good, matches: dated(89, 100) }, "1a")).toHaveLength(1);
    expect(fails({ ...good, matches: dated(90, 100) }, "1a")).toHaveLength(0);
    expect(fails({ ...good, matches: [] }, "1a")).toHaveLength(1);
  });
  it("1b: audit rates at most 10% with n at least 15", () => {
    expect(fails({ ...good, audit: { ...good.audit!, falseMatchRate: 0.101 } }, "1b")).toHaveLength(1);
    expect(fails({ ...good, audit: { ...good.audit!, missRate: 0.101 } }, "1b")).toHaveLength(1);
    expect(fails({ ...good, audit: { ...good.audit!, matchJudged: 14 } }, "1b")).toHaveLength(1);
    expect(fails({ ...good, audit: { ...good.audit!, rejectJudged: 14 } }, "1b")).toHaveLength(1);
  });
  it("1b: wrongly rejected share at most 5% of in-catalog", () => {
    expect(fails({ ...good, coverage: { ...good.coverage!, inCatalog: 40, inCatalogNotRejected: 38 } }, "1b")).toHaveLength(0);
    expect(fails({ ...good, coverage: { ...good.coverage!, inCatalog: 40, inCatalogNotRejected: 37 } }, "1b")).toHaveLength(1);
  });

  it("a missing input fails its check and says it is missing", () => {
    const g = stageGates({ today: "2026-11-02", matches: [] });
    for (const k of ["1a", "1b", "1c"] as const) expect(g[k].pass).toBe(false);
    expect(g["1a"].checks[0]!.value).toContain("没有");
    expect(g["1b"].checks[0]!.value).toContain("没有");
  });
  it("1c passes only when 1a and 1b both pass", () => {
    expect(stageGates({ ...good, registry: undefined })["1c"].pass).toBe(false);
    expect(stageGates({ ...good, audit: undefined })["1c"].pass).toBe(false);
  });

  it("apply-approved checks the gate before it gathers any queue or applies", () => {
    const cli = readFileSync(join(import.meta.dirname, "..", "src", "cli.ts"), "utf8");
    const at = cli.indexOf('case "apply-approved"');
    const gate = cli.indexOf('gates["1c"].pass', at);
    expect(gate).toBeGreaterThan(at);
    expect(gate).toBeLessThan(cli.indexOf("w.queue.filter", at));
    expect(gate).toBeLessThan(cli.indexOf("values.list", at));
  });
});

describe("1a dated: which matches count as dated", () => {
  const src = (dateKind: DateKind, date = "2026-10-30") => [{ dateKind, date }];
  it("counts an employer publishedAt", () => {
    expect(isDated({ publishedAt: "2026-10-30T00:00:00.000Z" })).toBe(true);
  });
  it("counts a GitHub-list list_posted date", () => {
    expect(isDated({ publishedAt: "", sources: src("list_posted") })).toBe(true);
  });
  it("does not count bounds, email receipt or HN post time", () => {
    for (const k of ["posted_before", "email_received", "post_time", "start_date", "updated", "none"] as const) expect(isDated({ publishedAt: "", sources: src(k) })).toBe(false);
  });
  it("does not count a list_posted row with no date", () => {
    expect(isDated({ publishedAt: "", sources: src("list_posted", "") })).toBe(false);
  });
  it("does not count a list_age: the stored date cannot tell a day-level age from a coarse one", () => {
    // Known gap: parseListAge emits list_age for "2d" and for "1mo" alike. Until the kind separates them, list_age stays uncounted.
    expect(isDated({ publishedAt: "", sources: src("list_age") })).toBe(false);
  });
  it("the gate names the 90% rule as official or list-stated dates", () => {
    const g = stageGates({ today: "2026-11-02", matches: [{ publishedAt: "", sources: [{ dateKind: "list_posted", date: "2026-10-30T00:00:00.000Z" }] }] });
    expect(g["1a"].checks.find((c) => c.name.startsWith("当前匹配岗位有发布日期"))).toMatchObject({ name: "当前匹配岗位有发布日期（官方或列表注明的日期）≥ 90.0%", pass: true });
  });
});
