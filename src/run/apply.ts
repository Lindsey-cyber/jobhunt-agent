import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { applicationKey, type ApplicationKey } from "../domain/form.ts";
import type { SubmitHelpers } from "../ats/adapter.ts";
import { adapterFor } from "../ats/registry.ts";
import { jobKey } from "../discover/identity.ts";
import { gmailConfigured, waitForSecurityCode } from "../sources/gmail.ts";
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
  if (gmailConfigured()) return { emailCode: (company, since) => waitForSecurityCode(company, since) };
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
  // Lever's posting page links to its form at /apply.
  if (u.hostname === "jobs.lever.co" && u.pathname.split("/").filter(Boolean).length === 2) return `${u.origin}${u.pathname.replace(/\/$/, "")}/apply`;
  return url;
}

async function run(page: Page, { url, user, ledger, approved = false, confirmTimeoutMs = 15000, job }: ApplyOptions): Promise<ApplyResult> {
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

  const form = await adapter.extract(page);
  // An embed page may carry no title and only the board slug ("pinterest").
  if (job && !form.jobTitle) form.jobTitle = job.title;
  if (job && /^[a-z0-9-]*$/.test(form.company)) form.company = job.company;
  if (job?.location && !form.jobLocation) form.jobLocation = job.location;
  const runDir = join(user.dir, "runs", slug(key), stamp());
  mkdirSync(runDir, { recursive: true });
  const save = (name: string, data: unknown) => writeFileSync(join(runDir, name), JSON.stringify(data, null, 2));

  const plan = buildPlan(form, user.profile, user.bank);
  save("plan.json", plan);
  ledger.transition(key, "planned", runDir);

  const fillErrors: string[] = [];
  for (const item of plan.items) {
    if (item.status !== "fill") continue;
    await adapter.fill(page, item.field, item.value).catch((e: Error) => fillErrors.push(`${item.field.label}: ${e.message}`));
  }

  const fieldsNow = (await adapter.extract(page)).fields;
  // Read back every planned field, including ones the page re-rendered away
  // (an upload input replaced by the uploaded file's name).
  const nowIds = new Set(fieldsNow.map((f) => f.id));
  const readback = await adapter.readback(page, [...fieldsNow, ...plan.items.map((i) => i.field).filter((f) => !nowIds.has(f.id))]);
  const compared = compareReadback(plan, fieldsNow, readback);
  const verify = { ...compared, ok: compared.ok && fillErrors.length === 0 };
  save("readback.json", readback);
  save("verify.json", { ...verify, fillErrors });
  await page.screenshot({ path: join(runDir, "before-submit.png"), fullPage: true });
  writeFileSync(join(runDir, "before-submit.aria.yaml"), await page.locator("body").ariaSnapshot());

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
      subject: `${form.company} · ${form.jobTitle}: ${why}`,
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
  await adapter.submit(page, codeHelper(), form.company);
  const confirmation = await adapter.confirmation(page, confirmTimeoutMs);
  await page.screenshot({ path: join(runDir, "after-submit.png"), fullPage: true });
  save("confirmation.json", confirmation);
  const state = confirmation ? "confirmed" : "unconfirmed";
  ledger.transition(key, state, runDir, confirmation);
  if (!confirmation) handOff("submit was clicked but no confirmation appeared (a security code or captcha may be waiting); check the screenshot and your inbox, and finish it by hand if it did not go through");
  return done(state);
}
