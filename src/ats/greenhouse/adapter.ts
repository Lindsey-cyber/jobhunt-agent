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
const CONFIRMED = /thank you for applying|application (has been )?(received|submitted)/i;

const cleanLabel = (s: string) => s.replace(/\s+/g, " ").replace(/\s*\*\s*$/, "").trim();

function comboboxContainer(page: Page, id: string): Locator {
  return page.locator(`${FORM} .select__container`).filter({ has: page.locator(`input[id="${id}"]`) });
}

async function openOptions(page: Page, id: string): Promise<string[]> {
  const container = comboboxContainer(page, id);
  await container.locator(".select__control").click();
  const options = container.locator('[role="option"]');
  await options.first().waitFor({ timeout: 3000 }).catch(() => undefined);
  const texts = (await options.allInnerTexts()).map((t) => t.trim());
  await page.keyboard.press("Escape");
  return texts;
}

export const greenhouse: AtsAdapter = {
  name: "greenhouse",

  detect: async (page) => (await page.locator(FORM).count()) > 0,

  async extract(page) {
    await page.locator(FORM).waitFor();
    const raw = (await page.evaluate(`(${EXTRACT})(document.querySelector(${JSON.stringify(FORM)}))`)) as RawField[];

    const fields: FormField[] = [];
    for (const f of raw) {
      const field: FormField = { id: f.id, label: cleanLabel(f.label), kind: f.kind as FormField["kind"], required: f.required, options: f.options };
      if (field.kind === "combobox") field.options = await openOptions(page, field.id);
      fields.push(field);
    }

    const company = (await page.locator("[data-company-name]").first().getAttribute("data-company-name").catch(() => null)) ?? new URL(page.url()).pathname.split("/").filter(Boolean)[0] ?? "";
    const jobTitle = (await page.locator("h1").first().innerText().catch(() => "")).trim();
    return { ats: "greenhouse", url: page.url(), company, jobTitle, fields };
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
        await container.locator(".select__control").click();
        if (field.options.length === 0) await el.fill(value);
        const options = container.locator('[role="option"]');
        await options.first().waitFor({ timeout: 5000 });
        const i = (await options.allInnerTexts()).findIndex((t) => normalize(t) === normalize(value));
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
        case "file":
          out[f.id] = await el.evaluate((x) => (x as HTMLInputElement).files?.[0]?.name ?? "");
          break;
        case "select":
          out[f.id] = await el.evaluate((x) => {
            const s = x as HTMLSelectElement;
            return s.value === "" ? "" : (s.selectedOptions[0]?.text.trim() ?? "");
          });
          break;
        case "combobox": {
          const container = comboboxContainer(page, f.id);
          const value = container.locator(".select__single-value");
          out[f.id] = (await value.count()) > 0 ? (await value.innerText()).trim() : "";
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

  async submit(page) {
    await page.locator(`${FORM} button[type="submit"]`).click();
  },

  async confirmation(page, timeoutMs) {
    const signal = page.getByText(CONFIRMED).first();
    const seen = await signal.waitFor({ timeout: timeoutMs }).then(() => true, () => false);
    return seen ? { text: (await signal.innerText()).trim(), url: page.url() } : null;
  },
};
