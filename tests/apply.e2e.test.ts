import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../src/dev/fixture-server.ts";
import { apply } from "../src/run/apply.ts";
import { Ledger } from "../src/store/ledger.ts";
import { makeUserData } from "./helpers.ts";

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
beforeEach(() => {
  server.submissions.length = 0;
});

const auto = { trust: "auto" as const, autoSubmitAts: ["greenhouse" as const] };

async function applyTo(name: string, user: ReturnType<typeof makeUserData>, approved = false) {
  const page = await browser.newPage();
  const ledger = new Ledger(join(user.dir, "ledger.jsonl"));
  try {
    return { ledger, result: await apply({ url: `${server.origin}/acmerobotics/jobs/${name}`, user, ledger, page, approved, confirmTimeoutMs: 5000 }) };
  } finally {
    await page.close();
  }
}

describe("apply on a Greenhouse form", () => {
  it("in draft mode fills and verifies everything, leaves evidence, and submits nothing", async () => {
    const { result } = await applyTo("basic", makeUserData());
    expect(result.outcome).toBe("done");
    if (result.outcome !== "done") return;
    expect(result.state).toBe("held");
    expect(result.verify.ok).toBe(true);
    expect(result.decision).toEqual({ decision: "hold", reasons: [expect.stringContaining("draft"), expect.stringContaining("autoSubmitAts")] });
    for (const f of ["plan.json", "readback.json", "verify.json", "gate.json", "before-submit.png", "before-submit.aria.yaml"]) {
      expect(existsSync(join(result.runDir, f)), f).toBe(true);
    }
    expect(server.submissions).toHaveLength(0);
  });

  it("in auto mode submits once, sees the confirmation, and the server received the right values", async () => {
    const user = makeUserData({ config: auto });
    const { result } = await applyTo("basic", user);
    expect(result).toMatchObject({ outcome: "done", state: "confirmed" });
    expect(server.submissions).toHaveLength(1);
    expect(server.submissions[0]!.body).toMatchObject({
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
      resume: "resume.pdf",
      question_101: "https://www.linkedin.com/in/example",
      question_102: "Yes",
      question_103: "Yes",
      gender: "I don't wish to answer",
    });

    const again = await applyTo("basic", user);
    expect(again.result).toMatchObject({ outcome: "skipped", state: "confirmed" });
    expect(server.submissions).toHaveLength(1);
  });

  it("holds a form with a required free-text question and a salary field, even in auto mode", async () => {
    const { result } = await applyTo("needs-human", makeUserData({ config: auto }));
    expect(result).toMatchObject({ outcome: "done", state: "held" });
    if (result.outcome !== "done" || result.decision.decision !== "hold") throw new Error("expected a hold");
    expect(result.decision.reasons.join("\n")).toMatch(/Why do you want to work at Acme Robotics[\s\S]*salary/);
    expect(server.submissions).toHaveLength(0);
  });

  it("a human answer in the bank clears the free-text question but never the salary field", async () => {
    const bank = { answers: [{ id: "why", question: "Why do you want to work at {company}?", aliases: [], answer: "{company} ships robots.", origin: "human" as const }] };
    const { result } = await applyTo("needs-human", makeUserData({ config: auto, bank }), true);
    if (result.outcome !== "done" || result.decision.decision !== "hold") throw new Error("expected a hold");
    expect(result.decision.reasons).toEqual([expect.stringContaining("salary"), expect.stringContaining("empty after filling")]);
    expect(server.submissions).toHaveLength(0);
  });

  it("catches a value the page silently discarded and does not submit", async () => {
    const { result } = await applyTo("drops-email", makeUserData({ config: auto }));
    expect(result).toMatchObject({ outcome: "done", state: "held" });
    if (result.outcome !== "done") return;
    expect(result.verify.checks.find((c) => c.fieldId === "email")).toMatchObject({ pass: false, actual: "" });
    expect(server.submissions).toHaveLength(0);
  });
});
