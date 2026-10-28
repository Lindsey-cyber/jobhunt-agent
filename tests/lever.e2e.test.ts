import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../src/dev/fixture-server.ts";
import { apply } from "../src/run/apply.ts";
import { Ledger } from "../src/store/ledger.ts";
import { makeUserData } from "./helpers.ts";

// Real capture of a Lever apply page (fixtures/lever/real-14fefcf2.html, scripts
// stripped). Lever's form is native HTML, so it fills without the page's scripts.
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

async function run(approved: boolean) {
  const user = makeUserData({ config: { trust: "auto", autoSubmitAts: ["lever"] } });
  const page = await browser.newPage();
  try {
    const result = await apply({ url: `${server.origin}/lever/real-14fefcf2/apply`, user, ledger: new Ledger(join(user.dir, "ledger.jsonl")), page, approved, confirmTimeoutMs: 2000 });
    if (result.outcome !== "done") throw new Error("expected a run");
    return result;
  } finally {
    await page.close();
  }
}

describe("apply on a real Lever capture", { timeout: 60_000 }, () => {
  it("fills and reads back what the profile answers, blocks the rest, and never submits through hCaptcha", async () => {
    const r = await run(true);
    expect(r.plan.form.ats).toBe("lever");
    const filled = Object.fromEntries(r.plan.items.filter((i) => i.status === "fill").map((i) => [i.field.id, i.value]));
    expect(filled).toMatchObject({ email: r.plan.items.length ? expect.any(String) : "", resume: expect.stringMatching(/resume\.pdf$/) });
    expect(filled.name).toMatch(/\S+ \S+/);
    expect(r.verify.checks.filter((c) => !c.pass)).toEqual([]);
    // Approved and auto-trusted, yet held: no approval lifts the captcha.
    expect(r.state).toBe("held");
    expect(r.decision.decision === "hold" && r.decision.reasons[0]).toMatch(/hCaptcha/);
    // The salary question and the signature field are never filled.
    expect(r.plan.items.find((i) => /salary/i.test(i.field.label))?.status).toBe("blocked");
    expect(r.plan.items.find((i) => i.field.id === "eeo[disabilitySignature]")?.status).not.toBe("fill");
    expect(server.submissions).toEqual([]);
  });
});
