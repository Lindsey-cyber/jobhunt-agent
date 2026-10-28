import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { applicationKey, type ApplicationKey } from "../domain/form.ts";
import { adapterFor } from "../ats/registry.ts";
import { gate, type GateDecision } from "../gate/gate.ts";
import { buildPlan, type FillPlan } from "../plan/plan.ts";
import type { UserData } from "../profile/load.ts";
import type { AppState, Ledger } from "../store/ledger.ts";
import { compareReadback, type VerifyReport } from "../verify/compare.ts";

export interface ApplyOptions {
  url: string;
  user: UserData;
  ledger: Ledger;
  approved?: boolean;
  page?: Page;
  headed?: boolean;
  confirmTimeoutMs?: number;
}

export type ApplyResult =
  | { outcome: "skipped"; key: ApplicationKey; state: AppState }
  | { outcome: "done"; key: ApplicationKey; state: AppState; runDir: string; plan: FillPlan; verify: VerifyReport; decision: GateDecision; fillErrors: string[] };

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const slug = (key: string) => key.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "");

export async function apply(opts: ApplyOptions): Promise<ApplyResult> {
  const browser = opts.page ? undefined : await chromium.launch({ headless: !opts.headed });
  const page = opts.page ?? (await browser!.newPage());
  try {
    return await run(page, opts);
  } finally {
    await browser?.close();
  }
}

async function run(page: Page, { url, user, ledger, approved = false, confirmTimeoutMs = 15000 }: ApplyOptions): Promise<ApplyResult> {
  await page.goto(url);
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
  await adapter.submit(page);
  const confirmation = await adapter.confirmation(page, confirmTimeoutMs);
  await page.screenshot({ path: join(runDir, "after-submit.png"), fullPage: true });
  save("confirmation.json", confirmation);
  const state = confirmation ? "confirmed" : "unconfirmed";
  ledger.transition(key, state, runDir, confirmation);
  return done(state);
}
