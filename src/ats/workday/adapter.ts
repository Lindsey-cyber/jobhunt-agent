import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "playwright";
import type { FieldKind, FormField } from "../../domain/form.ts";
import { DECLINE, normalize } from "../../plan/text.ts";
import { searchMatch } from "../../verify/compare.ts";
import type { AtsAdapter } from "../adapter.ts";

// Workday career sites (<tenant>.wdN.myworkdayjobs.com): an account per
// employer, then a wizard of pages (My Information, My Experience, Application
// Questions, Voluntary Disclosures, Self Identify, Review). Fields are keyed by
// data-automation-id. See .claude/skills/verify-apply/features/workday.md.
const EXTRACT = readFileSync(join(import.meta.dirname, "extract.browser.js"), "utf8").trim().replace(/;$/, "");
const CONFIRMED = /application (was |has been )?(successfully )?submitted|thank you for applying|successfully applied|your application has been received/i;
const ROOT = '[data-automation-id="applyFlowPage"]';

const box = (page: Page, id: string) => page.locator(`[data-automation-id="formField-${id.replace(/"/g, '\\"')}"]`).first();
const auto = (page: Page, id: string) => page.locator(`[data-automation-id="${id}"]`);

async function activeStep(page: Page): Promise<string> {
  const step = auto(page, "progressBarActiveStep").locator("label").last();
  return (await step.innerText({ timeout: 3000 }).catch(() => "")).trim();
}

async function waitSettled(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(1000);
}

async function pageError(page: Page): Promise<string> {
  const err = page.locator('[data-automation-id="errorMessage"], [data-automation-id="errorBanner"], [role="alert"]');
  // role=alert also carries notices ("… successfully uploaded").
  return (await err.allInnerTexts().catch(() => [])).map((t) => t.trim()).filter((t) => t && !/success/i.test(t)).join(" | ");
}

// Listbox options load when the menu opens.
// The open menu; selectedItemList lists are the chosen items of search boxes.
// Closed menus can stay in the page hidden; only a visible one is the open menu.
const MENU_OPTION = 'ul[role="listbox"]:not([data-automation-id="selectedItemList"]) [role="option"]:visible';

async function listboxOptions(page: Page, button: Locator): Promise<string[]> {
  // Some menus (Crowe's race list) open only on the third or fourth try.
  for (let attempt = 0; attempt < 5; attempt++) {
    // Wait for the previous menu to close, or its options are read as this one's.
    await page.locator(MENU_OPTION).first().waitFor({ state: "detached", timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(400 + 800 * attempt);
    await button.scrollIntoViewIfNeeded().catch(() => undefined);
    if (!(await button.click({ force: true, timeout: 5000 }).then(() => true, () => false))) return [];
    const opts = page.locator(MENU_OPTION);
    const opened = await opts.first().waitFor({ state: "visible", timeout: 4000 + 1000 * attempt }).then(() => true, () => false);
    const texts = opened ? (await opts.allInnerTexts()).map((t) => t.trim()).filter((t) => t && !/^select one$/i.test(t)) : [];
    // Escape does not close Workday menus; a second click on the button does.
    if (opened) await button.click({ force: true, timeout: 3000 }).catch(() => undefined);
    await page.locator(MENU_OPTION).first().waitFor({ state: "detached", timeout: 3000 }).catch(() => undefined);
    if (texts.length) return texts;
    await page.waitForTimeout(1000);
  }
  return [];
}

// The how-heard search box ("source") at GM lists fixed choices when clicked;
// typing does not filter them. Read the first level so the plan can choose among them.
async function promptOptions(page: Page, id: string): Promise<string[]> {
  const b = box(page, id);
  if ((await b.locator('[data-automation-id="selectedItem"]').count()) > 0) return [];
  const input = b.locator("input").first();
  if (!(await input.click({ force: true, timeout: 5000 }).then(() => true, () => false))) return [];
  const prompt = page.locator('[data-automation-id="promptOption"]');
  // HPE's list takes over two seconds; wait until it stops growing.
  for (let n = -1, t = 0; t < 10; t++) {
    await page.waitForTimeout(800);
    const c = await prompt.count();
    if (c === n && t >= 2) break;
    n = c;
  }
  // Chosen items elsewhere on the page (the phone code) share the automation id.
  const chosen = new Set((await page.locator('[data-automation-id="selectedItem"]').allInnerTexts().catch(() => [])).map((t) => t.trim()));
  const texts = (await prompt.allInnerTexts().catch(() => [])).map((t) => t.trim()).filter((t) => t && !chosen.has(t));
  await closePrompt(page);
  return texts;
}

// Escape does not close a search list, and an open one covers what follows (HPE's phone
// menu, GE Vernova's former-employee radio): click the blank page margin.
async function closePrompt(page: Page): Promise<void> {
  await page.keyboard.press("Escape").catch(() => undefined);
  // Any visible option outside a chip means the list is still open (it can lag under load).
  const open = page.locator('[data-automation-id="promptOption"]:not([data-automation-id="selectedItem"] *):visible');
  for (let t = 0; t < 6; t++) {
    await page.waitForTimeout(300 + 200 * t);
    if ((await open.count().catch(() => 0)) === 0) return;
    await page.mouse.click(5, 300 + 100 * (t % 3)).catch(() => undefined);
  }
}

// Choices made inside a category, by field id (see fill and readback).
const underCategory = new Map<string, { category: string; child: string }>();

async function clickOption(page: Page, value: string, match: (want: string, got: string) => boolean): Promise<void> {
  const opts = page.locator(`${MENU_OPTION}, [data-automation-id="promptOption"]:visible`);
  await opts.first().waitFor({ timeout: 8000 });
  const texts = (await opts.allInnerTexts()).map((t) => t.trim());
  let i = texts.findIndex((t) => normalize(t) === normalize(value));
  if (i < 0) i = texts.findIndex((t) => match(value, t));
  if (i < 0) throw new Error(`no option fits "${value}" (saw ${texts.slice(0, 6).join(" / ")})`);
  // The chosen-items strip and the page footer overlap open menus.
  await opts.nth(i).click({ force: true });
}

// Choose in a listbox dropdown and confirm the button now shows it; a click can
// land on the previous menu while it closes, so retry.
async function chooseInListbox(page: Page, b: Locator, value: string): Promise<void> {
  const button = b.locator('button[aria-haspopup="listbox"]').first();
  // "decline" from the plan (a menu whose options could not be read beforehand): click the
  // menu's own decline option, never type it (type-ahead picks the first entry).
  if (value === "decline") {
    const declined = async () => DECLINE.test(normalize((await button.innerText().catch(() => "")).trim()));
    for (let attempt = 0; attempt < 5 && !(await declined()); attempt++) {
      await page.locator(MENU_OPTION).first().waitFor({ state: "detached", timeout: 3000 }).catch(() => undefined);
      await page.waitForTimeout(500 + 700 * attempt);
      await button.scrollIntoViewIfNeeded().catch(() => undefined);
      await button.click({ force: true });
      const opts = page.locator(MENU_OPTION);
      if (!(await opts.first().waitFor({ state: "visible", timeout: 4000 + 1000 * attempt }).then(() => true, () => false))) continue;
      const texts = (await opts.allInnerTexts()).map((t) => t.trim());
      const i = texts.findIndex((t) => DECLINE.test(normalize(t)));
      if (i < 0) throw new Error(`no decline option (saw ${texts.slice(0, 6).join(" / ")})`);
      await opts.nth(i).click({ force: true });
      await page.waitForTimeout(600);
    }
    if (!(await declined())) throw new Error("the decline option did not stick in the dropdown");
    return;
  }
  const shows = async () => normalize((await button.innerText().catch(() => "")).trim()).startsWith(normalize(value));
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await shows()) return;
    await page.locator(MENU_OPTION).first().waitFor({ state: "detached", timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(500 + 700 * attempt);
    await button.scrollIntoViewIfNeeded().catch(() => undefined);
    if (attempt === 0) {
      await button.click({ force: true });
      await clickOption(page, value, (w, g) => normalize(g).startsWith(normalize(w))).catch(() => undefined);
    } else {
      // Keyboard: open, type-ahead to the option, Enter.
      await button.focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(500);
      await page.keyboard.type(value, { delay: 60 });
      await page.waitForTimeout(400);
      await page.keyboard.press("Enter");
    }
    await page.waitForTimeout(600);
  }
  if (!(await shows())) throw new Error(`"${value}" did not stick in the dropdown`);
}

// The account form's button: named for its action, or a plain "Submit" (NVIDIA).
const formButton = (page: Page, name: string) =>
  page.locator(`[data-automation-id="click_filter"][aria-label*="${name}" i]`).or(page.locator('[data-automation-id="click_filter"][aria-label="Submit"]')).first();

export const workday: AtsAdapter = {
  name: "workday",

  detect: async (page) => /myworkdayjobs\.com$|myworkdaysite\.com$/.test(new URL(page.url()).hostname),

  async prepare(page, account, helpers) {
    await waitSettled(page);
    // A removed posting (AT&T): "The page you are looking for doesn't exist."
    if (await page.getByText(/page you are looking for doesn.t exist|this job (posting )?is no longer available|job you are looking for is no longer/i).first().isVisible().catch(() => false)) {
      throw new Error("the posting is closed (Workday says the page does not exist)");
    }
    const accept = auto(page, "legalNoticeAcceptButton");
    if (await accept.isVisible().catch(() => false)) await accept.click();

    // The progress bar renders a moment after the page; look for up to 10 seconds.
    const onForm = async () => {
      for (let i = 0; i < 10; i++) {
        const step = await activeStep(page);
        if (step && !/create account|sign in/i.test(step)) return true;
        if (await auto(page, "email").first().isVisible().catch(() => false)) return false;
        await page.waitForTimeout(1000);
      }
      return false;
    };
    if (await onForm()) return;

    // NVIDIA opens on a chooser (Google / LinkedIn / email): the email form is behind its button.
    const emailChooser = async () => {
      await page.waitForTimeout(1000);
      const byEmail = page.getByRole("button", { name: /sign in with email/i }).first();
      if (!(await auto(page, "email").first().isVisible().catch(() => false)) && (await byEmail.isVisible().catch(() => false))) {
        await byEmail.click();
        await waitSettled(page);
      }
    };

    const signIn = async () => {
      if (await auto(page, "signInLink").isVisible().catch(() => false)) await auto(page, "signInLink").click();
      await emailChooser();
      await auto(page, "email").first().fill(account.email);
      await auto(page, "password").first().fill(account.password);
      await formButton(page, "Sign In").click();
      await waitSettled(page);
    };

    const create = async () => {
      const since = new Date();
      await auto(page, "email").first().fill(account.email);
      await auto(page, "password").first().fill(account.password);
      await auto(page, "verifyPassword").first().fill(account.password);
      const agree = auto(page, "createAccountCheckbox");
      if (await agree.isVisible().catch(() => false)) await agree.check();
      await formButton(page, "Create Account").click();
      await waitSettled(page);
      // The form's own "Verify New Password" label is not a verification notice.
      const said = `${await pageError(page)} ${await page.locator("body").innerText()}`.replace(/verify new password/gi, "");
      if (/already exists|already in use|already registered/i.test(said)) return signIn();
      if (/verify|verification|activate/i.test(said)) console.error("workday: waiting for the account verification email");
      // A new account is activated by an emailed link (the page may not say so).
      if (!(await onForm())) {
        const link = await helpers.emailLink?.(new URL(page.url()).hostname, since, 90_000);
        if (!link) return; // an existing account sends no new link; the fallback below uses the earlier one
        const back = page.url();
        await page.goto(link);
        await waitSettled(page);
        await page.goto(back);
        await waitSettled(page);
      }
      if (!(await onForm())) await signIn();
    };

    await emailChooser();
    // The page opens on either Create Account or Sign In. Known account: sign in.
    // Otherwise create it (Workday has one account per employer site).
    await auto(page, "email").first().waitFor({ timeout: 30000 });
    if ((await auto(page, "verifyPassword").count()) > 0) await create();
    else {
      await signIn();
      if (!(await onForm())) {
        const link = auto(page, "createAccountLink").or(page.getByRole("button", { name: /create account/i })).first();
        if (await link.isVisible().catch(() => false)) {
          await link.click();
          await auto(page, "verifyPassword").first().waitFor({ timeout: 15000 });
          await create();
        }
      }
    }

    // An account created earlier but never activated: use its link (valid 24 hours).
    if (!(await onForm())) {
      const link = await helpers.emailLink?.(new URL(page.url()).hostname, new Date(Date.now() - 24 * 3600_000), 20_000);
      if (link) {
        const back = page.url();
        await page.goto(link);
        await waitSettled(page);
        if (!(await onForm())) {
          await page.goto(back);
          await waitSettled(page);
          if (!(await onForm())) await signIn();
        }
      }
    }
    if (!(await onForm())) throw new Error(`could not reach the application after signing in: ${(await pageError(page)) || (await activeStep(page)) || page.url()}`);
  },

  async extract(page) {
    await page.locator(ROOT).first().waitFor({ timeout: 30000 });
    await waitSettled(page);
    // Question pages render their questions after the page itself (Review has none).
    await page.locator(`${ROOT} [data-automation-id^="formField-"]`).first().waitFor({ timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(1000);
    const raw = (await page.evaluate(`(${EXTRACT})(document)`)) as (Omit<FormField, "kind"> & { kind: FieldKind | "listbox" | "date" })[];
    const fields: FormField[] = [];
    for (const f of raw) {
      if (f.kind === "listbox") {
        const button = box(page, f.id).locator('button[aria-haspopup="listbox"]').first();
        let options = await listboxOptions(page, button);
        // A saved answer whose menu will not open: its value is the one option we can verify.
        const current = (await button.innerText().catch(() => "")).trim();
        if (!options.length && current && !/^select one$/i.test(current)) options = [current];
        // A menu that would not open: answer by its text and let the readback prove it.
        fields.push({ ...f, kind: options.length ? "select" : "combobox", options });
      }
      else if (f.kind === "combobox" && f.id === "source" && !f.options?.length) fields.push({ ...(f as FormField), options: await promptOptions(page, f.id) });
      else if (f.kind === "date") fields.push({ ...f, kind: "text" });
      else fields.push(f as FormField);
    }
    const host = new URL(page.url()).hostname.split(".")[0] ?? "";
    const jobTitle = (await auto(page, "jobTitleHeading").first().innerText({ timeout: 2000 }).catch(() => "")).trim();
    return { ats: "workday", url: page.url(), company: host, jobTitle, fields };
  },

  async fill(page, field, value) {
    const b = box(page, field.id);
    const date = b.locator('[data-automation-id^="dateSectionMonth"] input, input[data-automation-id^="dateSectionMonth"]');
    if ((await date.count()) > 0) {
      // "MM/YYYY" or "MM/DD/YYYY" typed into the spin boxes, which advance on their own.
      // The date wrapper's display layer covers the spin boxes; focus instead of clicking.
      await date.first().scrollIntoViewIfNeeded().catch(() => undefined);
      await date.first().focus();
      await page.keyboard.type(value.replace(/\D/g, ""), { delay: 80 });
      await page.keyboard.press("Tab");
      return;
    }
    switch (field.kind) {
      case "text":
      case "textarea":
        await b.locator("input:not([type=radio]):not([type=checkbox]):not([type=file]), textarea").first().fill(value);
        return;
      case "file":
        await b.locator('input[type="file"]').first().setInputFiles(value);
        await page.waitForTimeout(3000);
        return;
      case "select":
        return chooseInListbox(page, b, value);
      case "combobox": {
        if ((await b.locator('button[aria-haspopup="listbox"]').count()) > 0) return chooseInListbox(page, b, value);
        // Often pre-filled (country phone code); leave a right answer alone,
        // and clear a wrong one (an earlier attempt's pick).
        const pills = b.locator('[data-automation-id="selectedItem"]');
        const already = await pills.allInnerTexts().catch(() => []);
        if (already.some((t) => searchMatch(value, t))) return;
        for (let i = 0; i < already.length; i++) await b.locator('[data-automation-id="DELETE_charm"]').first().click({ force: true }).catch(() => undefined);
        const input = b.locator("input").first();
        await input.click({ force: true });
        await input.fill(value);
        const prompt = page.locator('[data-automation-id="promptOption"]');
        const pick = async () => {
          const texts = (await prompt.allInnerTexts().catch(() => [])).map((t) => t.trim());
          let i = texts.findIndex((t) => normalize(t) === normalize(value));
          if (i < 0) i = texts.findIndex((t) => searchMatch(value, t));
          if (i < 0) return false;
          await prompt.nth(i).click({ force: true });
          // A category's own list replaces this one after the click (slowly under load): wait for
          // the list to change, then to settle.
          const before = texts.join("|");
          for (let n = "", t = 0; t < 12; t++) {
            await page.waitForTimeout(600);
            if ((await pills.count()) > 0) break;
            const now = (await prompt.allInnerTexts().catch(() => [])).map((x) => x.trim()).join("|");
            if (now !== before && now === n) break;
            n = now;
          }
          // A category ("LinkedIn" at Draper) opens its own list instead of being chosen:
          // take the child that names the answer, or its only child.
          if ((await pills.count()) === 0 && (await prompt.count()) > 0) {
            // Chosen items elsewhere (the phone code) share the automation id.
            const chosen = new Set((await page.locator('[data-automation-id="selectedItem"]').allInnerTexts().catch(() => [])).map((t) => t.trim()));
            // Inside "Job Board" (GE Vernova), the board her postings come from, else "Other".
            // (HPE's children repeat the category: "Job Board 51 Jobs", "Job Board - Linkedin".)
            const choose = (all: string[]) => {
              const kids = all.map((t, j) => ({ t, j })).filter(({ t }) => !chosen.has(t));
              const k = kids.find(({ t }) => /\blinkedin\b/i.test(t))?.j ?? kids.find(({ t }) => normalize(t) === normalize(value))?.j ?? kids.find(({ t }) => /(^|\W)other$/i.test(t))?.j ?? -1;
              return { k: k < 0 && kids.length === 1 ? kids[0]!.j : k, more: kids.length > 1 };
            };
            let all = (await prompt.allInnerTexts().catch(() => [])).map((t) => t.trim());
            let { k, more } = choose(all);
            // HPE's list renders a screenful at a time: scroll for the rest.
            for (let t = 0; k < 0 && more && t < 15; t++) {
              const last = all[all.length - 1];
              await prompt.last().scrollIntoViewIfNeeded().catch(() => undefined);
              await page.mouse.wheel(0, 400).catch(() => undefined);
              await page.waitForTimeout(600);
              all = (await prompt.allInnerTexts().catch(() => [])).map((x) => x.trim());
              if (all[all.length - 1] === last) break;
              ({ k } = choose(all));
            }
            if (k >= 0) {
              await prompt.nth(k).click({ force: true });
              // The chip shows only the child ("Other"); the readback reports the category too.
              underCategory.set(field.id, { category: texts[i]!, child: all[k]! });
            }
          }
          return true;
        };
        await page.waitForTimeout(1500);
        // Suggestions as you type; otherwise Enter searches (and never take the list's first item blindly).
        if (!(await pick())) {
          await page.keyboard.press("Enter");
          await page.waitForTimeout(2000);
          const now = await pills.allInnerTexts().catch(() => []);
          if (!now.some((t) => searchMatch(value, t))) {
            if (now.length) await b.locator('[data-automation-id="DELETE_charm"]').first().click({ force: true }).catch(() => undefined);
            if (!(await pick())) throw new Error(`no suggestion fits "${value}" in ${field.id}`);
          }
        }
        await closePrompt(page);
        return;
      }
      case "radio":
      case "checkbox": {
        const inputs = b.locator(`input[type="${field.kind}"]`);
        for (let i = 0; i < (await inputs.count()); i++) {
          const input = inputs.nth(i);
          const id = await input.getAttribute("id");
          const label = id ? (await b.locator(`label[for="${id}"]`).innerText().catch(() => "")).trim() : "";
          if (normalize(label || field.label) === normalize(value)) return input.check({ force: true });
        }
        throw new Error(`no option "${value}" in ${field.id}`);
      }
    }
  },

  async readback(page, fields) {
    const out: Record<string, string> = {};
    for (const f of fields) {
      const b = box(page, f.id);
      if ((await b.count()) === 0) {
        out[f.id] = "";
        continue;
      }
      const month = b.locator('[data-automation-id^="dateSectionMonth"] input, input[data-automation-id^="dateSectionMonth"]');
      if ((await month.count()) > 0) {
        const year = b.locator('[data-automation-id^="dateSectionYear"] input, input[data-automation-id^="dateSectionYear"]');
        const m = await month.first().inputValue().catch(() => "");
        const day = b.locator('[data-automation-id^="dateSectionDay"] input, input[data-automation-id^="dateSectionDay"]');
        const dd = (await day.count()) ? await day.first().inputValue().catch(() => "") : "";
        const y = await year.first().inputValue().catch(() => "");
        out[f.id] = m && y ? [m.padStart(2, "0"), ...(dd ? [dd.padStart(2, "0")] : []), y].join("/") : "";
        continue;
      }
      switch (f.kind) {
        case "text":
        case "textarea":
          out[f.id] = await b.locator("input:not([type=radio]):not([type=checkbox]):not([type=file]), textarea").first().inputValue().catch(() => "");
          break;
        case "file":
          out[f.id] = (await b.locator('[data-automation-id="file-upload-item"], [data-automation-id="file-upload-item-name"]').allInnerTexts().catch(() => [])).join(" ").match(/[\w .()-]+\.(pdf|docx?|odt|rtf|txt)\b/i)?.[0]?.trim() ?? "";
          break;
        case "select": {
          const t = (await b.locator('button[aria-haspopup="listbox"]').first().innerText().catch(() => "")).trim();
          out[f.id] = /^select one$/i.test(t) ? "" : t;
          break;
        }
        case "combobox":
          if ((await b.locator('button[aria-haspopup="listbox"]').count()) > 0) {
            const t = (await b.locator('button[aria-haspopup="listbox"]').first().innerText().catch(() => "")).trim();
            out[f.id] = /^select one$/i.test(t) ? "" : t;
            break;
          }
          out[f.id] = [...new Set((await b.locator('[data-automation-id="selectedItem"]').allInnerTexts().catch(() => [])).map((t) => t.trim()).filter(Boolean))].join(", ");
          if (underCategory.get(f.id)?.child === out[f.id]) out[f.id] = `${underCategory.get(f.id)!.category} › ${out[f.id]}`;
          break;
        default: {
          const picked: string[] = [];
          const inputs = b.locator(`input[type="${f.kind}"]`);
          for (let i = 0; i < (await inputs.count()); i++) {
            const input = inputs.nth(i);
            if (!(await input.isChecked())) continue;
            const id = await input.getAttribute("id");
            picked.push(id ? (await b.locator(`label[for="${id}"]`).innerText().catch(() => "")).trim() || f.label : f.label);
          }
          out[f.id] = picked.join(", ");
        }
      }
    }
    return out;
  },

  async advance(page) {
    const before = await activeStep(page);
    await auto(page, "pageFooterNextButton").or(auto(page, "bottom-navigation-next-button")).first().click();
    // Saving can take a while; the button greys out until the next page loads.
    let after = before;
    for (let i = 0; i < 30 && after === before; i++) {
      await page.waitForTimeout(1000);
      after = await activeStep(page);
      if (after === before && (await pageError(page))) break;
    }
    await waitSettled(page);
    if (after === before) throw new Error(`Workday did not move past "${before}": ${(await pageError(page)) || "no error shown"}`);
    return /^review$/i.test(after) ? "review" : "next";
  },

  async submit(page) {
    await auto(page, "pageFooterNextButton").or(auto(page, "bottom-navigation-next-button")).first().click();
  },

  async confirmation(page, timeoutMs) {
    const signal = page.getByText(CONFIRMED).first();
    const seen = await signal.waitFor({ timeout: Math.max(timeoutMs, 20000) }).then(() => true, () => false);
    return seen ? { text: (await signal.innerText()).trim(), url: page.url() } : null;
  },
};
