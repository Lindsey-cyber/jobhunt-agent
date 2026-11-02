import { describe, expect, it } from "vitest";
import { applicationIndex, postingIdOf, postings, renderToday } from "../src/discover/today.ts";
import { Policy } from "../src/profile/schema.ts";

const policy = Policy.parse({ windowDays: 30, h1bRequiredSince: 2023, agentAts: ["greenhouse"] });
const sponsor = { company: "Acme", matched: ["ACME INC"], filings: 3, checkedAt: "2026-11-02" };
const job = (key: string, over: Record<string, unknown> = {}) => ({ key, company: "Acme", title: "ML Engineer, New Grad", location: "New York, NY", url: `https://x/${key}`, description: "", publishedAt: "2026-10-30", firstSeen: "2026-10-30", triage: { verdict: "match", rule: "match", reason: "" }, ...over }) as never;

describe("one identity and one state per posting", () => {
  it("resolves ledger keys to the posting's own id", () => {
    expect(postingIdOf("greenhouse:job-boards.greenhouse.io/acme/jobs/123")).toBe("greenhouse:123");
    expect(postingIdOf("greenhouse:boards.greenhouse.io/acme/jobs/123")).toBe("greenhouse:123");
  });
  it("gives a third-party copy the state of the official posting it links to", () => {
    const apps = applicationIndex([{ key: "greenhouse:job-boards.greenhouse.io/acme/jobs/123", state: "confirmed", at: "2026-10-31T00:00:00Z" }]);
    const ps = postings({ jobs: [job("greenhouse:123"), job("url:https://go.example/x", { link: { finalUrl: "https://job-boards.greenhouse.io/acme/jobs/123" } }), job("greenhouse:456"), job("workday:acme:9")], labels: new Map(), apps, h1b: new Map([["acme", sponsor]]), policy, today: "2026-11-02" });
    expect(ps.map((p) => p.state)).toEqual(["applied", "applied", "agent_queue", "yours"]);
  });
  it("counts a held application only while the posting is still eligible", () => {
    const apps = applicationIndex([{ key: "greenhouse:job-boards.greenhouse.io/acme/jobs/7", state: "held", at: "2026-10-31T00:00:00Z" }]);
    const base = { apps, h1b: new Map([["acme", sponsor]]), policy, today: "2026-11-02" };
    expect(postings({ ...base, jobs: [job("greenhouse:7")], labels: new Map() })[0]!.state).toBe("held");
    expect(postings({ ...base, jobs: [job("greenhouse:7")], labels: new Map([["greenhouse:7", "not_fit" as const]]) })[0]!.state).toBe("skipped");
  });
  it("keeps unmatched postings in review and policy rejects as skipped", () => {
    const ps = postings({ jobs: [job("greenhouse:1", { triage: { verdict: "review", rule: "level.unclear", reason: "" } }), job("greenhouse:2", { title: "Senior ML Engineer" })], labels: new Map(), apps: new Map(), h1b: new Map([["acme", sponsor]]), policy, today: "2026-11-02" });
    expect(ps.map((p) => p.state)).toEqual(["review", "skipped"]);
  });
  it("ranks to-dos by how many applications they unblock", () => {
    const md = renderToday({ jobs: [], labels: new Map(), apps: new Map(), h1b: new Map(), policy, today: "2026-11-02", posts: [], appliedToday: [], blockers: [
      { company: "Skild AI", title: "A", question: "Why do you want to work at Skild AI?" },
      { company: "Skild AI", title: "B", question: "Why do you want to work at Skild AI?" },
      { company: "Acme", title: "C", question: "Pronouns" },
    ] });
    expect(md.indexOf("放行 2 份")).toBeLessThan(md.indexOf("放行 1 份"));
  });
});
