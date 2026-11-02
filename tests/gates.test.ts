import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isDated, stageGates, type GateInput } from "../src/discover/gates.ts";
import type { DateKind } from "../src/domain/job.ts";

const dated = (n: number, of: number) => Array.from({ length: of }, (_, i) => ({ publishedAt: i < n ? "2026-10-30" : "" }));
const good: GateInput = {
  registry: [{ status: "live" }, { status: "no_api" }],
  today: "2026-11-02",
  matches: dated(9, 10),
  audit: { falseMatchRate: 0.1, missRate: 0.1, matchJudged: 15, rejectJudged: 15 },
};
const fails = (i: GateInput, g: "1a" | "1b" | "1c") => stageGates(i)[g].checks.filter((c) => !c.pass).map((c) => c.name);
const COMPLETENESS = "每家目标公司的官方招聘板今天读完";
const WRONG_REJECT = "在库但被规则误拒";

describe("stage gates", () => {
  it("per-company completeness is unmeasured, so with every other input perfect 1a, 1b and 1c still fail", () => {
    const g = stageGates(good);
    expect(fails(good, "1a")).toEqual([COMPLETENESS]);
    expect(fails(good, "1b")).toEqual([WRONG_REJECT]);
    expect(g["1a"].checks.find((c) => c.name === COMPLETENESS)?.value).toBe("未测量: per-company completeness not built yet");
    expect(g["1a"].pass || g["1b"].pass || g["1c"].pass).toBe(false);
    expect(fails(good, "1c")).toEqual(["1a 搜全通过", "1b 筛对通过"]);
  });
  it("a data/coverage file cannot unblock it: the gate takes no coverage input", () => {
    const withLegacy = { ...good, coverage: { date: "2026-11-02", n: 100, inCatalog: 100, inCatalogNotRejected: 100 } } as unknown as GateInput;
    expect(stageGates(withLegacy)["1c"].pass).toBe(false);
  });

  it("1a: a deferred row is accounted for only with a reason, and is listed", () => {
    const withReason = { ...good, registry: [{ id: "yc", status: "deferred" as const, reason: "83% of hiring companies have 50 people or fewer" }, { status: "live" as const }] };
    const g = stageGates(withReason)["1a"];
    expect(g.checks.filter((c) => !c.pass).map((c) => c.name)).toEqual([COMPLETENESS]);
    expect(g.checks.find((c) => c.name.includes("推迟"))?.value).toContain("yc");
    for (const reason of [undefined, "", "   "]) {
      const bad = stageGates({ ...good, registry: [{ id: "yc", status: "deferred" as const, reason }, { status: "live" as const }] })["1a"];
      expect(bad.pass).toBe(false);
      expect(bad.checks.find((c) => c.name.includes("推迟"))?.value).toContain("yc");
    }
  });

  it("1a: the registry must exist and have no not_built", () => {
    expect(stageGates({ ...good, registry: undefined })["1a"].checks.find((c) => c.name.includes("推迟"))?.value).toBe("来源登记表未建");
    expect(fails({ ...good, registry: [{ status: "not_built" }] }, "1a")).toHaveLength(2);
    expect(fails({ ...good, registry: [] }, "1a")).toHaveLength(2);
  });
  it("1a: at least 90% of matches dated", () => {
    expect(fails({ ...good, matches: dated(89, 100) }, "1a")).toHaveLength(2);
    expect(fails({ ...good, matches: dated(90, 100) }, "1a")).toHaveLength(1);
    expect(fails({ ...good, matches: [] }, "1a")).toHaveLength(2);
  });
  it("1b: audit rates at most 10% with n at least 15", () => {
    expect(fails({ ...good, audit: { ...good.audit!, falseMatchRate: 0.101 } }, "1b")).toHaveLength(2);
    expect(fails({ ...good, audit: { ...good.audit!, missRate: 0.101 } }, "1b")).toHaveLength(2);
    expect(fails({ ...good, audit: { ...good.audit!, matchJudged: 14 } }, "1b")).toHaveLength(2);
    expect(fails({ ...good, audit: { ...good.audit!, rejectJudged: 14 } }, "1b")).toHaveLength(2);
  });
  it("a missing input fails its check and says it is missing", () => {
    const g = stageGates({ today: "2026-11-02", matches: [] });
    for (const k of ["1a", "1b", "1c"] as const) expect(g[k].pass).toBe(false);
    expect(g["1a"].checks[0]!.value).toContain("未测量");
    expect(g["1a"].checks.at(-1)!.value).toContain("没有");
    expect(g["1b"].checks[0]!.value).toContain("没有");
  });
  it("1c is blocked while 1a is blocked, whatever else holds", () => {
    expect(stageGates(good)["1c"].checks.find((c) => c.name === "1a 搜全通过")?.pass).toBe(false);
    expect(stageGates({ ...good, audit: undefined })["1c"].pass).toBe(false);
  });
  it("apply refuses at gate 1c: jh apply and jh apply-approved both pass the 1c gate on, and apply holds when it fails", () => {
    const cli = readFileSync(join(import.meta.dirname, "..", "src", "cli.ts"), "utf8");
    expect(cli.match(/stageGate: gatesOf\(u, w\)\["1c"\]/g)?.length).toBe(1);
    expect(cli.match(/stageGate: gates\["1c"\]/g)?.length).toBe(1);
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
  it("counts a day-level list age, never a coarse one", () => {
    expect(isDated({ publishedAt: "", sources: src("list_age_day") })).toBe(true);
    expect(isDated({ publishedAt: "", sources: src("list_age_day", "") })).toBe(false);
    expect(isDated({ publishedAt: "", sources: src("list_age") })).toBe(false);
  });
  it("the gate names the 90% rule as official or list-stated dates", () => {
    const g = stageGates({ today: "2026-11-02", matches: [{ publishedAt: "", sources: [{ dateKind: "list_posted", date: "2026-10-30T00:00:00.000Z" }] }] });
    expect(g["1a"].checks.find((c) => c.name.startsWith("当前匹配岗位有发布日期"))).toMatchObject({ name: "当前匹配岗位有发布日期（官方或列表注明的日期）≥ 90.0%", pass: true });
  });
});
