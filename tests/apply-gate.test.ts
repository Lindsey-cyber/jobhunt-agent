import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../src/dev/fixture-server.ts";
import { eligibleNow, postings } from "../src/discover/today.ts";
import { Policy } from "../src/profile/schema.ts";
import { apply } from "../src/run/apply.ts";
import { Ledger } from "../src/store/ledger.ts";
import { eligibleGate, makeUserData, passingGate } from "./helpers.ts";

let server: FixtureServer;
let browser: Browser;
beforeAll(async () => {
  server = await startFixtureServer();
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
  await server.close();
});

const failingGate = { pass: false, checks: [{ name: "1a 搜全通过", value: "未通过", pass: false }, { name: "1b 筛对通过", value: "通过", pass: true }] };

describe("apply() enforces gate 1c at the submit site", { timeout: 30_000 }, () => {
  for (const approved of [false, true]) {
    it(`a failing gate never submits (approved=${approved}), holds with the failing checks, and never writes submitted`, async () => {
      const user = makeUserData({ config: { trust: "auto", autoSubmitAts: ["greenhouse"] } });
      const ledger = new Ledger(join(user.dir, "ledger.jsonl"));
      const page = await browser.newPage();
      server.submissions.length = 0;
      const r = await apply({ url: `${server.origin}/acmerobotics/jobs/basic`, user, ledger, page, approved, stageGate: failingGate, eligible: eligibleGate, confirmTimeoutMs: 3000 });
      await page.close();
      expect(r).toMatchObject({ outcome: "done", state: "held" });
      if (r.outcome !== "done" || r.decision.decision !== "hold") throw new Error("expected a hold");
      expect(r.decision.reasons.join("\n")).toContain("1a 搜全通过");
      expect(r.decision.reasons.join("\n")).not.toContain("1b 筛对通过");
      expect(server.submissions).toHaveLength(0);
      expect(ledger.history(r.key).map((e) => e.state)).not.toContain("submitted");
      expect(existsSync(join(r.runDir, "before-submit.png"))).toBe(true);
    });
  }

  it("a posting that is not eligible now (66 Degrees: auth.no_sponsorship) never submits, even approved, and the hold names why", async () => {
    const user = makeUserData({ config: { trust: "auto", autoSubmitAts: ["greenhouse"] } });
    const ledger = new Ledger(join(user.dir, "ledger.jsonl"));
    const policy = Policy.parse({ h1bRequiredSince: 2023, agentAts: ["greenhouse"] });
    const sixtySix = { key: "greenhouse:6220259004", company: "66degrees", title: "Data Engineer, New Grad", location: "New York, NY", url: "https://job-boards.greenhouse.io/66degrees/jobs/6220259004", description: "", publishedAt: "2026-11-01", firstSeen: "2026-11-01", triage: { verdict: "reject", rule: "auth.no_sponsorship", reason: "cannot sponsor" } } as never;
    const posts = postings({ jobs: [sixtySix], labels: new Map(), apps: new Map(), h1b: new Map([["66 degrees", { company: "66degrees", matched: ["66DEGREES"], filings: 4, checkedAt: "2026-11-02" }]]), policy, today: "2026-11-02" });
    // The ledger names the posting by page path; the catalog by job id.
    const eligible = eligibleNow("https://boards.greenhouse.io/66degrees/jobs/6220259004", posts);
    expect(eligible.ok).toBe(false);
    expect(eligible.reasons.join()).toContain("auth.no_sponsorship");
    expect(eligibleNow(`${server.origin}/nobody/jobs/1`, posts)).toMatchObject({ ok: false });
    const page = await browser.newPage();
    server.submissions.length = 0;
    const r = await apply({ url: `${server.origin}/acmerobotics/jobs/basic`, user, ledger, page, approved: true, stageGate: passingGate, eligible, confirmTimeoutMs: 3000 });
    await page.close();
    expect(r).toMatchObject({ outcome: "done", state: "held" });
    if (r.outcome !== "done" || r.decision.decision !== "hold") throw new Error("expected a hold");
    expect(r.decision.reasons.join("\n")).toContain("auth.no_sponsorship");
    expect(server.submissions).toHaveLength(0);
    expect(ledger.history(r.key).map((e) => e.state)).not.toContain("submitted");
    expect(existsSync(join(r.runDir, "before-submit.png"))).toBe(true);
  });

  it("the same run with a passing gate does submit", async () => {
    const user = makeUserData({ config: { trust: "auto", autoSubmitAts: ["greenhouse"] } });
    const page = await browser.newPage();
    server.submissions.length = 0;
    const r = await apply({ url: `${server.origin}/acmerobotics/jobs/basic`, user, ledger: new Ledger(join(user.dir, "ledger.jsonl")), page, stageGate: passingGate, eligible: eligibleGate, confirmTimeoutMs: 5000 });
    await page.close();
    expect(r).toMatchObject({ state: "confirmed" });
    expect(server.submissions).toHaveLength(1);
  });
});
