import { describe, expect, it } from "vitest";
import { applyOrder, eligibility } from "../src/discover/eligibility.ts";
import { Policy } from "../src/profile/schema.ts";

const policy = Policy.parse({ excludeCompanies: ["Jane Street"], freshDays: 30, excludeSeniorTitles: true, h1bRequiredSince: 2023, agentAts: ["greenhouse"], excludeTitles: ["analytics engineer"] });
const sponsor = { company: "Acme", matched: ["ACME INC"], filings: 3, checkedAt: "2026-11-02" };
const none = { ...sponsor, matched: [], filings: 0 };
const job = (over: Record<string, unknown> = {}) => ({ key: "greenhouse:1", company: "Acme", title: "Machine Learning Engineer, New Grad", description: "", publishedAt: "2026-10-20", firstSeen: "2026-10-21", triage: { verdict: "match", rule: "match", reason: "" }, ...over }) as never;
const check = (j: never, extra: Record<string, unknown> = {}) => eligibility({ job: j, h1b: sponsor, policy, today: "2026-11-02", ...extra });

describe("eligibility (data/policy.yaml)", () => {
  it("passes a fresh match at a sponsor on the agent's ATS", () => {
    expect(check(job())).toEqual({ ok: true, lane: "agent", reasons: [] });
    expect(check(job({ key: "workday:x" })).lane).toBe("you");
  });
  it("names every reason a posting is out", () => {
    expect(check(job(), { label: "not_fit" }).reasons).toContain("you marked it not to apply");
    expect(check(job({ triage: { verdict: "review", rule: "level.unclear", reason: "" } })).reasons).toEqual(["not a match (level.unclear)"]);
    expect(check(job({ triage: { verdict: "review", rule: "level.unclear", reason: "" } }), { label: "fit" }).ok).toBe(true);
    expect(check(job({ company: "Jane Street" })).reasons).toEqual(["excluded company (Jane Street)"]);
    expect(check(job({ title: "Senior Machine Learning Engineer" })).reasons).toEqual(["senior title"]);
    expect(check(job({ title: "AI Analytics Engineer - Traffic" })).reasons).toEqual(["excluded title (analytics engineer)"]);
    expect(check(job({ title: "Senior/Software Engineer, ML" })).ok).toBe(true);
    expect(check(job({ publishedAt: "", firstSeen: "2026-10-30" })).ok).toBe(true);
    expect(check(job(), { h1b: none }).reasons).toEqual(["no H-1B filings since 2023"]);
    expect(check(job(), { h1b: undefined }).reasons).toEqual(["H-1B history not looked up yet"]);
    expect(eligibility({ job: job(), h1b: undefined, policy: { ...policy, h1bRequiredSince: null }, today: "2026-11-02" }).ok).toBe(true);
    expect(check(job({ link: { status: "invalid" } })).reasons).toEqual(["posting closed"]);
  });
  it("keeps a posting of any age, and one with no date", () => {
    expect(check(job({ publishedAt: "2026-09-01" }))).toEqual({ ok: true, lane: "agent", reasons: [] });
    expect(check(job({ publishedAt: "", firstSeen: "" })).ok).toBe(true);
  });
  it("applies fresh postings first, then by tier, then newest first; older and undated ones after", () => {
    const j = (title: string, publishedAt: string, tier: "A" | "B" | "C") => ({ title, publishedAt, firstSeen: "", tier });
    const jobs = [j("old A", "2026-09-01", "A"), j("fresh C", "2026-11-01", "C"), j("undated A", "", "A"), j("fresh A older", "2026-10-10", "A"), j("fresh A newer", "2026-10-30", "A"), j("old C", "2026-09-20", "C"), j("edge A", "2026-10-03", "A")];
    expect(applyOrder(jobs, policy, "2026-11-02", (x) => x.tier).map((x) => x.title)).toEqual(["fresh A newer", "fresh A older", "edge A", "fresh C", "old A", "undated A", "old C"]);
  });
});
