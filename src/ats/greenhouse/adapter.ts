import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "playwright";
import type { FormField } from "../../domain/form.ts";
import { normalize } from "../../plan/text.ts";
import type { AtsAdapter } from "../adapter.ts";

// Markup is the new job-boards.greenhouse.io form as documented in formhand's
// adapters/greenhouse.js (MIT), which verified it against real captures.
// See .claude/skills/verify-apply/features/greenhouse.md for what is still unverified here.
const FORM = "form#application-form";
// Plain JS read at runtime: tsx rewrites functions passed to the browser with helpers the page does not have.
const EXTRACT = readFileSync(join(import.meta.dirname, "extract.browser.js"), "utf8");

interface RawField {
  id: string;
  label: string;
  kind: string;
  required: boolean;
  options: string[];
}
const CONFIRMED = /thank you for applying|application (has been )?(received|submitted|sent)/i;

const cleanLabel = (s: string) => s.replace(/\s+/g, " ").replace(/\s*\*\s*$/, "").trim();
// The phone country list reads "United States +1"; the dialing code is not part of the answer.
const optionText = (s: string) => s.trim().replace(/\s+\+\d{1,4}$/, "");

function comboboxContainer(page: Page, id: string): Locator {
  // CSS :has(), not filter({ has }): on live boards the latter matched nothing.
  return page.locator(`${FORM} .select__container:has(input[id="${id}"])`);
}

// Opens a dropdown and lists its options. A menu that opens empty is a
// server-searched field; a menu that never opened means the page was not ready.
async function openOptions(page: Page, id: string): Promise<{ opened: boolean; options: string[] }> {
  const container = comboboxContainer(page, id);
  await container.locator(".select__control").click();
  const opened = await container.locator('.select__menu, [role="listbox"]').first().waitFor({ timeout: 2000 }).then(() => true, () => false);
  const options = container.locator('[role="option"]');
  if (opened) await options.first().waitFor({ timeout: 1500 }).catch(() => undefined);
  const texts = (await options.allInnerTexts()).map(optionText);
  await page.keyboard.press("Escape");
  return { opened, options: texts };
}

export const greenhouse: AtsAdapter = {
  name: "greenhouse",

  // The form renders after load on live boards, so wait for it briefly.
  // Lever's form has the same id; its questions are .application-question blocks.
  detect: async (page) =>
    !/(lever\.co|ashbyhq\.com|myworkdayjobs\.com)$/.test(new URL(page.url()).hostname) &&
    (await page.locator(FORM).first().waitFor({ timeout: 8000 }).then(() => true, () => false)) &&
    (await page.locator(`${FORM} .application-question`).count()) === 0,

  async extract(page) {
    await page.locator(FORM).waitFor();
    const raw = (await page.evaluate(`(${EXTRACT})(document.querySelector(${JSON.stringify(FORM)}))`)) as RawField[];

    const fields: FormField[] = [];
    for (const f of raw) {
      const field: FormField = { id: f.id, label: cleanLabel(f.label), kind: f.kind as FormField["kind"], required: f.required, options: f.options };
      if (field.kind === "combobox") {
        // The form is server-rendered before it is interactive: a dropdown that
        // ignores the click is retried once the page has hydrated.
        let r = await openOptions(page, field.id);
        for (let i = 0; !r.opened && i < 3; i++) {
          await page.waitForTimeout(1500);
          r = await openOptions(page, field.id);
        }
        field.options = r.options;
      }
      fields.push(field);
    }

    // Boards title the page "Job Application for <title> at <Company>"; the URL only has the board slug.
    const fromTitle = / at (.+?)\s*$/.exec(await page.title())?.[1];
    const company =
      (await page.locator("[data-company-name]").first().getAttribute("data-company-name", { timeout: 1000 }).catch(() => null)) ??
      fromTitle ??
      new URL(page.url()).searchParams.get("for") ??
      new URL(page.url()).pathname.split("/").filter(Boolean)[0] ??
      "";
    const jobTitle = (await page.locator("h1").first().innerText().catch(() => "")).trim();
    const jobLocation = (await page.locator(".job__location").first().innerText({ timeout: 2000 }).catch(() => "")).trim();
    return { ats: "greenhouse", url: page.url(), company, jobTitle, ...(jobLocation ? { jobLocation } : {}), fields };
  },

  async fill(page, field, value) {
    const el = page.locator(`${FORM} [id="${field.id}"]`);
    switch (field.kind) {
      case "text":
      case "textarea":
        await el.fill(value);
        return;
      case "file":
        await el.setInputFiles(value);
        return;
      case "select":
        await el.selectOption({ label: value });
        return;
      case "combobox": {
        const container = comboboxContainer(page, field.id);
        const options = container.locator('[role="option"]');
        // The first dropdown on a page can be clicked before React hydrates it
        // (Country stayed empty on Waymo, Pinterest, NewsBreak); try again.
        for (let attempt = 1; ; attempt++) {
          await container.locator(".select__control").click();
          // Long lists (schools) show only their first page until you type.
          if (!field.options.some((o) => normalize(o) === normalize(value))) await el.fill(value);
          const opened = await options.first().waitFor({ timeout: 5000 }).then(() => true, () => false);
          if (opened) break;
          if (attempt === 3) throw new Error(`the ${field.id} menu did not open`);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(2000);
        }
        const i = (await options.allInnerTexts()).findIndex((t) => normalize(optionText(t)) === normalize(value));
        if (i < 0) throw new Error(`no option "${value}" in ${field.id}`);
        await options.nth(i).click();
        return;
      }
      case "radio":
      case "checkbox": {
        const group = page.locator(`${FORM} input[name="${field.id}"]`);
        const n = await group.count();
        for (let i = 0; i < n; i++) {
          const input = group.nth(i);
          const text = await input.evaluate((x) => ((x as HTMLInputElement).labels?.[0]?.textContent ?? (x as HTMLInputElement).value).trim());
          if (normalize(text) === normalize(value)) return input.check();
        }
        throw new Error(`no option "${value}" in ${field.id}`);
      }
    }
  },

  async readback(page, fields) {
    const out: Record<string, string> = {};
    for (const f of fields) {
      const el = page.locator(`${FORM} [id="${f.id}"]`);
      switch (f.kind) {
        case "text":
        case "textarea":
          out[f.id] = await el.inputValue();
          break;
        case "file": {
          // After an upload the board replaces the input with the file's name.
          const shown = page.locator(`${FORM} [role="group"][aria-labelledby="upload-label-${f.id}"] p`);
          out[f.id] = (await el.count()) > 0 ? await el.evaluate((x) => (x as HTMLInputElement).files?.[0]?.name ?? "") : "";
          if (!out[f.id] && (await shown.count()) > 0) out[f.id] = (await shown.first().innerText()).trim();
          break;
        }
        case "select":
          out[f.id] = await el.evaluate((x) => {
            const s = x as HTMLSelectElement;
            return s.value === "" ? "" : (s.selectedOptions[0]?.text.trim() ?? "");
          });
          break;
        case "combobox": {
          const container = comboboxContainer(page, f.id);
          const value = container.locator(".select__single-value");
          // Multi-selects show each choice as a tag instead of one value.
          const tags = container.locator(".select__multi-value__label");
          out[f.id] = (await value.count()) > 0 ? optionText(await value.innerText()) : (await tags.allInnerTexts()).map(optionText).join(", ");
          // A value shown as a dialing code ("+1") is ambiguous; read which option the menu marks selected.
          if (/^\+\d+$/.test(out[f.id]!)) {
            await container.locator(".select__control").click();
            const selected = container.locator(".select__option--is-selected");
            await selected.first().waitFor({ timeout: 3000 }).catch(() => undefined);
            out[f.id] = (await selected.count()) > 0 ? optionText(await selected.first().innerText()) : "";
            await page.keyboard.press("Escape");
          }
          break;
        }
        case "radio":
        case "checkbox":
          out[f.id] = await page.locator(`${FORM} input[name="${f.id}"]:checked`).evaluateAll((xs) =>
            xs.map((x) => ((x as HTMLInputElement).labels?.[0]?.textContent ?? (x as HTMLInputElement).value).trim()).join(", "),
          );
          break;
      }
    }
    return out;
  },

  // Some boards email an 8-character code after the first click and accept the
  // application only when it is entered. Each click sends a new code, so it
  // must be entered in this same page; without a code the run ends unconfirmed.
  async submit(page, helpers, company = "") {
    const clicked = new Date();
    await page.locator(`${FORM} button[type="submit"]`).click();
    const asked = await page.getByText(/verification code was sent/i).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
    if (!asked || !helpers?.emailCode) return;
    const code = await helpers.emailCode(company, clicked);
    if (!code) return;
    const boxes = page.locator(`${FORM} input[id^="security-input"], ${FORM} input[maxlength="1"]`);
    await boxes.first().click();
    await page.keyboard.type(code, { delay: 60 });
    await page.locator(`${FORM} button[type="submit"]`).click();
  },

  async confirmation(page, timeoutMs) {
    const signal = page.getByText(CONFIRMED).first();
    const seen = await signal.waitFor({ timeout: timeoutMs }).then(() => true, () => false);
    return seen ? { text: (await signal.innerText()).trim(), url: page.url() } : null;
  },
};
