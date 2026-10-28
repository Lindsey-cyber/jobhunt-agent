import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../src/dev/fixture-server.ts";
import { apply } from "../src/run/apply.ts";
import { Ledger } from "../src/store/ledger.ts";
import { searchMatch } from "../src/verify/compare.ts";
import { makeUserData } from "./helpers.ts";

// Real capture of an Ashby application page (fixtures/ashby/real-quora-40659fe7.html,
// scripts stripped). Native inputs fill; the React-only widgets (yes/no buttons,
// search boxes) cannot work without the page's scripts and are proven live.
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

describe("apply on a real Ashby capture", { timeout: 60_000 }, () => {
  it("reads every question, fills the native fields, reads them back and does not submit", async () => {
    const user = makeUserData();
    const page = await browser.newPage();
    try {
      const r = await apply({ url: `${server.origin}/ashby/real-quora-40659fe7/application`, user, ledger: new Ledger(join(user.dir, "ledger.jsonl")), page, confirmTimeoutMs: 2000 });
      if (r.outcome !== "done") throw new Error("expected a run");
      const form = r.plan.form;
      expect(form).toMatchObject({ ats: "ashby", company: "Quora", jobTitle: expect.stringContaining("Machine Learning Engineer"), jobLocation: expect.stringContaining("United States") });
      const kinds = Object.fromEntries(form.fields.map((f) => [f.id, f.kind]));
      expect(kinds).toMatchObject({ _systemfield_name: "text", _systemfield_email: "text", _systemfield_resume: "file", _systemfield_location: "combobox", communicationConsent: "radio" });
      // Yes/no questions are two buttons; radio groups and the EEO checkbox group keep their labels.
      expect(form.fields.find((f) => f.id === "c9551cc9-9177-462c-b1d5-5f24f22552e9")).toMatchObject({ kind: "radio", options: ["Yes", "No"], required: true });
      expect(form.fields.find((f) => f.kind === "checkbox")?.options).toContain("I prefer not to say");

      const check = (id: string) => r.verify.checks.find((c) => c.fieldId === id);
      expect(check("_systemfield_name")?.pass).toBe(true);
      expect(check("_systemfield_email")?.pass).toBe(true);
      expect(check("_systemfield_resume")?.pass).toBe(true);
      // Draft trust: held, nothing sent.
      expect(r.state).toBe("held");
      expect(server.submissions).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it("accepts a search suggestion in the service's own wording, not a different place", () => {
    expect(searchMatch("New York, New York, United States", "New York, NY, United States")).toBe(true);
    expect(searchMatch("Columbia University", "Columbia University in the City of New York")).toBe(true);
    expect(searchMatch("New York, New York, United States", "York, PA, United States")).toBe(false);
    expect(searchMatch("Columbia University", "Columbia College Chicago")).toBe(false);
  });
});
