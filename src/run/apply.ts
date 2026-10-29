import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { applicationKey, type ApplicationKey } from "../domain/form.ts";
import type { AtsAdapter, SubmitHelpers } from "../ats/adapter.ts";
import { adapterFor } from "../ats/registry.ts";
import { jobKey } from "../discover/identity.ts";
import { gmailConfigured, waitForEmailLink, waitForSecurityCode } from "../sources/gmail.ts";
import type { FormSnapshot } from "../domain/form.ts";
import { accountFor } from "./accounts.ts";
import { readCatalog } from "../store/catalog.ts";
import { paths } from "../store/state.ts";
import type { JobKey } from "../domain/job.ts";
import { gate, type GateDecision } from "../gate/gate.ts";
import { buildPlan, type FillPlan } from "../plan/plan.ts";
import type { UserData } from "../profile/load.ts";
import type { AppState, Ledger } from "../store/ledger.ts";
import { ReviewList } from "../store/review.ts";
import { compareReadback, type VerifyReport } from "../verify/compare.ts";

export interface ApplyOptions {
  url: string;
  user: UserData;
  ledger: Ledger;
  approved?: boolean;
  page?: Page;
  headed?: boolean;
  confirmTimeoutMs?: number;
  // The catalog's names for the posting, for embed pages that show neither.
  job?: { company: string; title: string; location?: string };
}

export type ApplyResult =
  | { outcome: "skipped"; key: ApplicationKey; state: AppState }
  | { outcome: "done"; key: ApplicationKey; state: AppState; runDir: string; plan: FillPlan; verify: VerifyReport; decision: GateDecision; fillErrors: string[] };

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const slug = (key: string) => key.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "");

// Where an emailed security code comes from: the Gmail API when authorized;
// otherwise a file named by JH_CODE_FILE that a session fills from the inbox.
function codeHelper(): SubmitHelpers {
  if (gmailConfigured()) return { emailCode: (company, since) => waitForSecurityCode(company, since), emailLink: (host, since, timeoutMs) => waitForEmailLink(host, since, timeoutMs) };
  const file = process.env.JH_CODE_FILE;
  if (!file) return {};
  return {
    emailCode: async () => {
      console.error(`waiting for the emailed security code in ${file}`);
      for (let i = 0; i < 120; i++) {
        if (existsSync(file)) {
          const code = readFileSync(file, "utf8").trim();
          rmSync(file);
          return code;
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
      return undefined;
    },
  };
}

export async function apply(opts: ApplyOptions): Promise<ApplyResult> {
  const browser = opts.page ? undefined : await chromium.launch({ headless: !opts.headed });
  const page = opts.page ?? (await browser!.newPage());
  try {
    return await run(page, opts);
  } finally {
    await browser?.close();
  }
}

// The same posting reached through another URL (an employer domain with
// gh_jid, the embed form) must never count as a new application.
export function sameJob(ledger: Ledger, url: string): { key: ApplicationKey; state: AppState } | undefined {
  const id = jobKey(url);
  if (id.startsWith("url:")) return undefined;
  const hit = ledger.latest().find((e) => jobKey(`https://${e.key.slice(e.key.indexOf(":") + 1)}`) === id);
  return hit && { key: hit.key, state: hit.state };
}

// Hosted Greenhouse boards may redirect to the employer's careers page and
// frame the form there; the embed URL serves the same form directly.
export function formUrl(url: string): string {
  const id = jobKey(url);
  const u = new URL(url);
  const board = u.pathname.split("/").filter(Boolean)[0];
  if (id.startsWith("greenhouse:") && u.hostname.endsWith("greenhouse.io") && board && board !== "embed") {
    return `https://job-boards.greenhouse.io/embed/job_app?for=${board}&token=${id.slice("greenhouse:".length)}`;
  }
  // Workday: the posting's /apply/applyManually starts the form without the resume-parsing autofill.
  if (/\.myworkdayjobs\.com$/.test(u.hostname) && /\/job\//.test(u.pathname) && !/\/apply(\/|$)/.test(u.pathname)) return `${u.origin}${u.pathname.replace(/\/$/, "")}/apply/applyManually`;
  // Ashby's posting page links to its form at /application.
  if (u.hostname === "jobs.ashbyhq.com" && u.pathname.split("/").filter(Boolean).length === 2) return `${u.origin}${u.pathname.replace(/\/$/, "")}/application`;
  // Lever's posting page links to its form at /apply.
  if (u.hostname === "jobs.lever.co" && u.pathname.split("/").filter(Boolean).length === 2) return `${u.origin}${u.pathname.replace(/\/$/, "")}/apply`;
  return url;
}

async function run(page: Page, { url, user, ledger, approved = false, confirmTimeoutMs = 15000, job: given }: ApplyOptions): Promise<ApplyResult> {
  let job = given;
  const earlier = sameJob(ledger, url);
  if (earlier && !ledger.canStart(earlier.key)) return { outcome: "skipped", key: earlier.key, state: earlier.state };
  await page.goto(formUrl(url));
  if (/[?&]error=true/.test(page.url())) throw new Error(`the posting is closed (the board redirected to ${page.url()})`);
  // Boards sometimes serve a blank page to quick repeat visits; reload with backoff before giving up.
  let adapter = await adapterFor(page);
  for (let i = 1; !adapter && i <= 3; i++) {
    await page.waitForTimeout(5000 * i);
    await page.reload();
    adapter = await adapterFor(page);
  }
  if (!adapter) throw new Error(`no adapter recognizes ${url}`);

  const key = applicationKey(adapter.name, url);
  const prior = ledger.state(key);
  if (!ledger.canStart(key)) return { outcome: "skipped", key, state: prior! };

  const runDir = join(user.dir, "runs", slug(key), stamp());
  mkdirSync(runDir, { recursive: true });
  const save = (name: string, data: unknown) => writeFileSync(join(runDir, name), JSON.stringify(data, null, 2));

  // Multi-page sites (Workday) sign in first.
  if (adapter.prepare) {
    await adapter.prepare(page, accountFor(new URL(page.url()).hostname, user.profile.contact.email), codeHelper()).catch(async (e: Error) => {
      await page.screenshot({ path: join(runDir, "prepare-failed.png"), fullPage: true }).catch(() => undefined);
      writeFileSync(join(runDir, "prepare-failed.html"), await page.content().catch(() => ""));
      throw new Error(`${e.message} (evidence in ${runDir})`);
    });
  }

  // A posting run by hand (jh apply) is named from the catalog when the page is not.
  if (!job) {
    const hit = readCatalog(paths(user.dir).catalog).get(jobKey(url) as JobKey);
    if (hit) job = { company: hit.company, title: hit.title, location: hit.location };
  }
  // Earlier applications to the same employer site (Workday tenants, boards).
  const host = new URL(page.url()).hostname;
  const board = new URL(url).pathname.split("/").filter(Boolean)[0];
  const priorApplications = ledger.latest().filter((e) => e.key !== key && /^(submitted|confirmed|unconfirmed)$/.test(e.state) && (/myworkdayjobs/.test(host) ? e.key.includes(host) : board !== undefined && e.key.includes(`/${board}/`))).length;
  const named = (f: FormSnapshot): FormSnapshot => {
    f.priorApplications = priorApplications;
    // An embed page may carry no title and only the board slug ("pinterest").
    if (job && !f.jobTitle) f.jobTitle = job.title;
    if (job && /^[a-z0-9-]*$/.test(f.company)) f.company = job.company;
    if (job?.location && !f.jobLocation) f.jobLocation = job.location;
    return f;
  };
  const first = named(await adapter.extract(page));
  ledger.transition(key, "planned", runDir);

  // One page at a time: fill, read back, and move on only when the page is right.
  const pages: PageResult[] = [];
  let form = first;
  for (let n = 1; ; n++) {
    const r = await fillPage(adapter, page, form, user);
    pages.push(r);
    if (adapter.advance) {
      writeFileSync(join(runDir, `page-${n}.html`), await page.content());
      await page.screenshot({ path: join(runDir, `page-${n}.png`), fullPage: true });
    }
    const pageOk = r.verify.ok && !r.plan.items.some((i) => i.status === "blocked");
    if (!adapter.advance || !pageOk || n >= 12) break;
    const step = await adapter.advance(page).catch(async (e: Error) => {
      // The page would not move on: hold with evidence, never guess past it.
      await page.screenshot({ path: join(runDir, `page-${n}-not-saved.png`), fullPage: true }).catch(() => undefined);
      r.fillErrors.push(`continue: ${e.message}`);
      r.verify.ok = false;
      return "stuck" as const;
    });
    if (step !== "next") break;
    form = { ...(await adapter.extract(page)), company: first.company, jobTitle: first.jobTitle, priorApplications, ...(first.jobLocation ? { jobLocation: first.jobLocation } : {}) };
  }
  const plan: FillPlan = { form: { ...first, fields: pages.flatMap((p) => p.plan.form.fields) }, items: pages.flatMap((p) => p.plan.items) };
  const fillErrors = pages.flatMap((p) => p.fillErrors);
  const verify: VerifyReport = {
    ok: pages.every((p) => p.verify.ok),
    checks: pages.flatMap((p) => p.verify.checks),
    emptyRequired: pages.flatMap((p) => p.verify.emptyRequired),
  };
  save("plan.json", plan);
  save("readback.json", Object.assign({}, ...pages.map((p) => p.readback)));
  save("verify.json", { ...verify, fillErrors });
  await page.screenshot({ path: join(runDir, "before-submit.png"), fullPage: true });
  writeFileSync(join(runDir, "before-submit.aria.yaml"), await page.locator("body").ariaSnapshot());
  const form0 = first;

  const submittedToday = ledger.submittedOn(new Date().toISOString().slice(0, 10));
  const blockers = (await adapter.blockers?.(page)) ?? [];
  const decision = gate({ plan, verify, config: user.config, submittedToday, approved, blockers });
  save("gate.json", decision);
  const done = (state: AppState) => ({ outcome: "done" as const, key, state, runDir, plan, verify, decision, fillErrors });

  // What the agent cannot submit goes to the candidate's daily list with the evidence.
  const handOff = (why: string) =>
    new ReviewList(join(user.dir, "review.jsonl")).refresh({
      id: `submit:${key}`,
      kind: "submit_by_hand",
      subject: `${form0.company} · ${form0.jobTitle}: ${why}`,
      detail: `Filled values and screenshots: ${runDir}`,
      link: url,
    });
  if (blockers.length && verify.ok && !plan.items.some((i) => i.status === "blocked")) handOff(blockers.join("; "));

  if (!verify.ok) {
    ledger.transition(key, "held", runDir, decision);
    return done("held");
  }
  ledger.transition(key, "verified", runDir);
  if (decision.decision === "hold") {
    ledger.transition(key, "held", runDir, decision);
    return done("held");
  }

  // Recorded before the click: if anything dies after this line the
  // application can never be retried automatically.
  ledger.transition(key, "submitted", runDir, { approved });
  await adapter.submit(page, codeHelper(), form0.company);
  const confirmation = await adapter.confirmation(page, confirmTimeoutMs);
  await page.screenshot({ path: join(runDir, "after-submit.png"), fullPage: true });
  save("confirmation.json", confirmation);
  const state = confirmation ? "confirmed" : "unconfirmed";
  ledger.transition(key, state, runDir, confirmation);
  if (!confirmation) handOff("submit was clicked but no confirmation appeared (a security code or captcha may be waiting); check the screenshot and your inbox, and finish it by hand if it did not go through");
  return done(state);
}

interface PageResult {
  plan: FillPlan;
  readback: Record<string, string>;
  verify: VerifyReport;
  fillErrors: string[];
}

async function fillPage(adapter: AtsAdapter, page: Page, form: FormSnapshot, user: UserData): Promise<PageResult> {
  const plan = buildPlan(form, user.profile, user.bank);
  const fillErrors: string[] = [];
  const failed = new Set<string>();
  const fillAll = async (items: FillPlan["items"]) => {
    for (const item of items) {
      if (item.status !== "fill") continue;
      await adapter.fill(page, item.field, item.value).catch((e: Error) => {
        failed.add(item.field.id);
        fillErrors.push(`${item.field.label}: ${e.message}`);
      });
    }
  };
  await fillAll(plan.items);
  let fieldsNow = (await adapter.extract(page)).fields;
  // Answers can reveal questions (a ticked "I have a preferred name", ADI's
  // export-control follow-ups, each revealing the next): plan and fill them, a few rounds.
  for (let round = 0; round < 3; round++) {
    const known = new Set(plan.items.map((i) => i.field.id));
    const revealed = fieldsNow.filter((f) => !known.has(f.id));
    if (!revealed.length) break;
    const more = buildPlan({ ...form, fields: revealed }, user.profile, user.bank).items;
    plan.items.push(...more);
    plan.form = { ...plan.form, fields: [...plan.form.fields, ...revealed] };
    await fillAll(more);
    fieldsNow = (await adapter.extract(page)).fields;
  }
  // A later answer can re-render the page and drop an earlier one: re-fill what no longer reads back.
  {
    const ids = new Set(fieldsNow.map((f) => f.id));
    const rb = await adapter.readback(page, fieldsNow);
    const lost = plan.items.filter((i) => i.status === "fill" && ids.has(i.field.id) && !failed.has(i.field.id) && i.field.kind !== "file" && !(rb[i.field.id] ?? "").trim());
    if (lost.length) await fillAll(lost);
  }
  // Read back every planned field, including ones the page re-rendered away
  // (an upload input replaced by the uploaded file's name).
  const nowIds = new Set(fieldsNow.map((f) => f.id));
  const readback = await adapter.readback(page, [...fieldsNow, ...plan.items.map((i) => i.field).filter((f) => !nowIds.has(f.id))]);
  const compared = compareReadback(plan, fieldsNow, readback);
  return { plan, readback, verify: { ...compared, ok: compared.ok && fillErrors.length === 0 }, fillErrors };
}
