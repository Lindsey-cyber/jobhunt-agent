import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FormField } from "../../domain/form.ts";
import { normalize } from "../../plan/text.ts";
import type { AtsAdapter } from "../adapter.ts";

// Built from a real capture of jobs.lever.co/<company>/<id>/apply (see
// .claude/skills/verify-apply/features/lever.md). Lever's form is plain HTML:
// every field is a native input named after the field, so ids are names.
const FORM = "form#application-form";
const EXTRACT = readFileSync(join(import.meta.dirname, "extract.browser.js"), "utf8");
const CONFIRMED = /application (has been )?submitted|thank you for (applying|your application)|thanks for applying/i;

const byName = (name: string) => `${FORM} [name="${name.replace(/"/g, '\\"')}"]`;

export const lever: AtsAdapter = {
  name: "lever",

  detect: async (page) => page.locator(`${FORM} .application-question`).first().waitFor({ timeout: 8000 }).then(() => true, () => false),

  async extract(page) {
    const form = page.locator(FORM).first();
    await form.waitFor();
    const raw = (await page.evaluate(`(${EXTRACT})(document.querySelector(${JSON.stringify(FORM)}))`)) as FormField[];
    const company = new URL(page.url()).pathname.split("/").filter(Boolean)[0] ?? "";
    const jobTitle = (await page.locator(".posting-header h2, .posting-headline h2").first().innerText().catch(() => "")).trim();
    const jobLocation = (await page.locator(".posting-categories .location, .posting-category.location").first().innerText().catch(() => "")).trim();
    return { ats: "lever", url: page.url(), company, jobTitle, ...(jobLocation ? { jobLocation } : {}), fields: raw };
  },

  async fill(page, field, value) {
    const el = page.locator(byName(field.id));
    switch (field.kind) {
      case "text":
      case "textarea":
        await el.first().fill(value);
        return;
      case "file":
        await el.first().setInputFiles(value);
        return;
      case "select":
        await el.first().selectOption({ label: value });
        return;
      case "radio":
      case "checkbox": {
        const n = await el.count();
        for (let i = 0; i < n; i++) {
          if (normalize((await el.nth(i).getAttribute("value")) ?? "") === normalize(value)) return el.nth(i).check();
        }
        throw new Error(`no option "${value}" in ${field.id}`);
      }
      case "combobox":
        throw new Error(`Lever has no combobox fields; got ${field.id}`);
    }
  },

  async readback(page, fields) {
    const out: Record<string, string> = {};
    for (const f of fields) {
      const el = page.locator(byName(f.id));
      if ((await el.count()) === 0) {
        out[f.id] = "";
        continue;
      }
      switch (f.kind) {
        case "text":
        case "textarea":
          out[f.id] = await el.first().inputValue();
          break;
        case "file":
          out[f.id] = await el.first().evaluate((x) => (x as HTMLInputElement).files?.[0]?.name ?? "");
          break;
        case "select":
          out[f.id] = await el.first().evaluate((x) => {
            const s = x as HTMLSelectElement;
            return s.value === "" ? "" : (s.selectedOptions[0]?.text.trim() ?? "");
          });
          break;
        default:
          out[f.id] = (await el.evaluateAll((xs) => xs.filter((x) => (x as HTMLInputElement).checked).map((x) => (x as HTMLInputElement).value))).join(", ");
      }
    }
    return out;
  },

  // Lever runs hCaptcha when the visible submit button is pressed. The agent
  // must not solve a captcha, and a challenge after the click would leave an
  // application "unconfirmed" forever, so it never clicks: the candidate submits.
  async blockers(page) {
    const captcha = await page.locator(`${FORM} [name="h-captcha-response"], ${FORM} #hcaptchaSubmitBtn, iframe[src*="hcaptcha"]`).count();
    return captcha > 0 ? ["Lever submits through hCaptcha: review the filled form and press Submit yourself"] : [];
  },

  async submit(page) {
    await page.locator(`${FORM} button[type="submit"]:visible, ${FORM} #btn-submit`).first().click();
  },

  async confirmation(page, timeoutMs) {
    const signal = page.getByText(CONFIRMED).first();
    const seen = await signal.waitFor({ timeout: timeoutMs }).then(() => true, () => false);
    return seen ? { text: (await signal.innerText()).trim(), url: page.url() } : null;
  },
};
