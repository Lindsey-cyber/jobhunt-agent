import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "playwright";
import type { FormField } from "../../domain/form.ts";
import { normalize } from "../../plan/text.ts";
import { searchMatch } from "../../verify/compare.ts";
import type { AtsAdapter } from "../adapter.ts";

// Built from a real capture of jobs.ashbyhq.com/<org>/<id>/application (see
// .claude/skills/verify-apply/features/ashby.md). Ashby renders the form with
// React: each question is a field entry keyed by data-field-path, yes/no
// questions are two buttons, location and school are search boxes.
const ENTRY = ".ashby-application-form-field-entry";
const EXTRACT = readFileSync(join(import.meta.dirname, "extract.browser.js"), "utf8").trim().replace(/;$/, "");
const CONFIRMED = /application (was |has been )?(successfully )?(submitted|received)|thank you for (applying|your application)|thanks for applying/i;

const entryOf = (page: Page, id: string) => page.locator(`[data-field-path="${id.replace(/"/g, '\\"')}"]`).first();

async function optionLabels(entry: Locator, selector: string): Promise<{ input: Locator; label: string }[]> {
  const inputs = entry.locator(selector);
  const out = [];
  for (let i = 0; i < (await inputs.count()); i++) {
    const input = inputs.nth(i);
    const id = await input.getAttribute("id");
    const label = id ? (await entry.locator(`label[for="${id}"]`).innerText().catch(() => "")).trim() : "";
    out.push({ input, label: label || ((await input.getAttribute("value")) ?? "") });
  }
  return out;
}

// Ashby's "Education History" system field: one block of school (a search box),
// degree, field of study and start/end month-year dropdowns. The plan's value is
// "School | Degree | Field | MM/YYYY | MM/YYYY", and the readback is the same shape.
export const EDUCATION = "_systemfield_education_history";

async function fillEducation(page: Page, entry: Locator, value: string): Promise<void> {
  const [school, degree, major, start, end] = value.split(" | ").map((x) => x.trim());
  const search = entry.locator('input[role="combobox"]').first();
  await search.click();
  await search.fill(school!);
  const options = page.locator('[role="listbox"] [role="option"]');
  await options.first().waitFor({ timeout: 8000 });
  const texts = await options.allInnerTexts();
  const i = texts.findIndex((t) => normalize(t).startsWith(normalize(school!)));
  if (i < 0) throw new Error(`no school suggestion starts with "${school}"`);
  await options.nth(i).click();
  await entry.locator(`[id="${EDUCATION}-degree"]`).fill(degree!);
  await entry.locator(`[id="${EDUCATION}-major"]`).fill(major!);
  for (const [part, date] of [["startDate", start], ["endDate", end]] as const) {
    if (!date) continue;
    const [m, y] = date.split("/");
    const selects = entry.locator(`[id="${EDUCATION}-${part}"] select`);
    await selects.nth(0).selectOption({ value: String(Number(m)) });
    await selects.nth(1).selectOption({ label: y! });
  }
}

async function readEducation(entry: Locator): Promise<string> {
  const v = (sel: string) => entry.locator(sel).first().inputValue({ timeout: 1000 }).catch(() => "");
  const date = async (part: string) => {
    const s = entry.locator(`[id="${EDUCATION}-${part}"] select`);
    const [m, y] = [await s.nth(0).inputValue({ timeout: 1000 }).catch(() => ""), await s.nth(1).evaluate((x) => (x as HTMLSelectElement).selectedOptions[0]?.text.trim() ?? "", undefined, { timeout: 1000 }).catch(() => "")];
    return m && y ? `${m.padStart(2, "0")}/${y}` : "";
  };
  const parts = [await v('input[role="combobox"]'), await v(`[id="${EDUCATION}-degree"]`), await v(`[id="${EDUCATION}-major"]`), await date("startDate"), await date("endDate")];
  return parts.some(Boolean) ? parts.join(" | ") : "";
}

export const ashby: AtsAdapter = {
  name: "ashby",

  detect: async (page) =>
    new URL(page.url()).hostname.endsWith("ashbyhq.com") || /\/ashby\//.test(page.url())
      ? page.locator(ENTRY).first().waitFor({ timeout: 10000 }).then(() => true, () => false)
      : false,

  async extract(page) {
    await page.locator(ENTRY).first().waitFor();
    const fields = (await page.evaluate(`(${EXTRACT})(document)`)) as FormField[];
    // "<title> @ <Company>"
    const company = /@\s*(.+?)\s*$/.exec(await page.title())?.[1] ?? new URL(page.url()).pathname.split("/").filter(Boolean)[0] ?? "";
    const jobTitle = (await page.locator("h1.ashby-job-posting-heading").first().innerText().catch(() => "")).trim();
    const jobLocation = (
      await page
        .locator(".ashby-job-posting-left-pane h2", { hasText: /^Location$/ })
        .first()
        .locator("xpath=following-sibling::p[1]")
        .innerText({ timeout: 2000 })
        .catch(() => "")
    ).trim();
    return { ats: "ashby", url: page.url(), company, jobTitle, ...(jobLocation ? { jobLocation } : {}), fields };
  },

  async fill(page, field, value) {
    if (field.id === "communicationConsent") {
      await page.locator(`input[name="communicationConsent"][value="${/^yes/i.test(value) ? "given" : "notGiven"}"]`).check();
      return;
    }
    const entry = entryOf(page, field.id);
    if (field.id === EDUCATION) return fillEducation(page, entry, value);
    switch (field.kind) {
      case "text":
      case "textarea":
        await entry.locator("input:not([type=radio]):not([type=checkbox]):not([type=file]), textarea").first().fill(value);
        return;
      case "file":
        await entry.locator('input[type="file"]').first().setInputFiles(value);
        return;
      case "select":
        await entry.locator("select").first().selectOption({ label: value });
        return;
      case "radio": {
        const yesno = entry.locator("button[data-option]");
        if ((await yesno.count()) > 0) {
          await entry.locator(`button[data-option="${normalize(value).startsWith("yes") ? "yes" : "no"}"]`).click();
          return;
        }
        const hit = (await optionLabels(entry, 'input[type="radio"]')).find((o) => normalize(o.label) === normalize(value));
        if (!hit) throw new Error(`no option "${value}" in ${field.id}`);
        await hit.input.check({ force: true });
        return;
      }
      case "checkbox": {
        const hit = (await optionLabels(entry, 'input[type="checkbox"]')).find((o) => normalize(o.label) === normalize(value));
        if (!hit) throw new Error(`no option "${value}" in ${field.id}`);
        await hit.input.check({ force: true });
        return;
      }
      case "combobox": {
        // A search box: type, wait for the service's suggestions, take the one that fits.
        const input = entry.locator('input[role="combobox"]').first();
        await input.click();
        await input.fill(value);
        const options = page.locator('[role="listbox"] [role="option"]');
        await options.first().waitFor({ timeout: 8000 });
        const texts = await options.allInnerTexts();
        let i = texts.findIndex((t) => normalize(t) === normalize(value));
        if (i < 0) i = texts.findIndex((t) => searchMatch(value, t));
        if (i < 0) {
          // Too specific for the search: retry with the first part ("New York").
          await input.fill(value.split(",")[0]!);
          await page.waitForTimeout(1500);
          const again = await options.allInnerTexts();
          i = again.findIndex((t) => searchMatch(value, t));
        }
        if (i < 0) throw new Error(`no suggestion fits "${value}" in ${field.id}`);
        await options.nth(i).click();
        return;
      }
    }
  },

  async readback(page, fields) {
    const out: Record<string, string> = {};
    for (const f of fields) {
      if (f.id === "communicationConsent") {
        // Nothing checked is an answer too; never wait for a checked box to appear.
        const checked = page.locator('input[name="communicationConsent"]:checked');
        const v = (await checked.count()) ? await checked.first().getAttribute("value") : null;
        out[f.id] = v === "given" ? "Yes" : v === "notGiven" ? "No" : "";
        continue;
      }
      const entry = entryOf(page, f.id);
      if ((await entry.count()) === 0) {
        out[f.id] = "";
        continue;
      }
      if (f.id === EDUCATION) {
        out[f.id] = await readEducation(entry);
        continue;
      }
      switch (f.kind) {
        case "text":
        case "textarea":
        case "combobox":
          out[f.id] = await entry
            .locator("input:not([type=radio]):not([type=checkbox]):not([type=file]), textarea")
            .first()
            .inputValue()
            .catch(() => "");
          break;
        case "file": {
          const name = await entry.locator('input[type="file"]').first().evaluate((x) => (x as HTMLInputElement).files?.[0]?.name ?? "").catch(() => "");
          // After an upload Ashby replaces the dropzone with the file's name.
          out[f.id] = name || ((await entry.innerText().catch(() => "")).match(/[\w .()-]+\.(pdf|docx?|odt|rtf|txt)\b/i)?.[0]?.trim() ?? "");
          break;
        }
        case "select":
          out[f.id] = await entry.locator("select").first().evaluate((x) => (x as HTMLSelectElement).selectedOptions[0]?.text.trim() ?? "");
          break;
        case "radio": {
          const pressed = entry.locator('button[data-option][aria-pressed="true"]');
          if ((await entry.locator("button[data-option]").count()) > 0) {
            out[f.id] = (await pressed.count()) ? (await pressed.first().innerText()).trim() : "";
            break;
          }
          const checked = (await optionLabels(entry, 'input[type="radio"]')).filter((o) => o.input);
          const picked = [];
          for (const o of checked) if (await o.input.isChecked()) picked.push(o.label);
          out[f.id] = picked.join(", ");
          break;
        }
        case "checkbox": {
          const picked = [];
          for (const o of await optionLabels(entry, 'input[type="checkbox"]')) if (await o.input.isChecked()) picked.push(o.label);
          out[f.id] = picked.join(", ");
          break;
        }
      }
    }
    return out;
  },

  // Ashby runs invisible reCAPTCHA on submit. It asks nothing of a person; if a
  // visible challenge ever appears, the page is not ours to submit.
  async blockers(page) {
    const challenge = await page.locator('iframe[src*="recaptcha"][src*="bframe"]:visible, iframe[src*="hcaptcha"]:visible').count();
    return challenge > 0 ? ["Ashby showed a captcha challenge: review the filled form and press Submit yourself"] : [];
  },

  async submit(page) {
    await page.locator("button.ashby-application-form-submit-button").first().click();
  },

  async confirmation(page, timeoutMs) {
    const signal = page.getByText(CONFIRMED).first();
    const seen = await signal.waitFor({ timeout: timeoutMs }).then(() => true, () => false);
    return seen ? { text: (await signal.innerText()).trim(), url: page.url() } : null;
  },
};
