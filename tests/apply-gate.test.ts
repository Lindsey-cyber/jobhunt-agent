import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../src/dev/fixture-server.ts";
import { apply } from "../src/run/apply.ts";
import { Ledger } from "../src/store/ledger.ts";
import { makeUserData, passingGate } from "./helpers.ts";

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
      const r = await apply({ url: `${server.origin}/acmerobotics/jobs/basic`, user, ledger, page, approved, stageGate: failingGate, confirmTimeoutMs: 3000 });
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

  it("the same run with a passing gate does submit", async () => {
    const user = makeUserData({ config: { trust: "auto", autoSubmitAts: ["greenhouse"] } });
    const page = await browser.newPage();
    server.submissions.length = 0;
    const r = await apply({ url: `${server.origin}/acmerobotics/jobs/basic`, user, ledger: new Ledger(join(user.dir, "ledger.jsonl")), page, stageGate: passingGate, confirmTimeoutMs: 5000 });
    await page.close();
    expect(r).toMatchObject({ state: "confirmed" });
    expect(server.submissions).toHaveLength(1);
  });
});
