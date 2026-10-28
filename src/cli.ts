import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { loadUserData } from "./profile/load.ts";
import { apply } from "./run/apply.ts";
import { Ledger } from "./store/ledger.ts";

const USAGE = `jh <command>

  apply <url> [--approve] [--headed]   fill, verify and (if the gate allows) submit one application
  status                               latest state of every application
  pending                              held applications and what each one needs
  doctor                               check the data directory and the browser`;

process.stdout.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EPIPE") process.exit(0);
  throw e;
});

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { approve: { type: "boolean", default: false }, headed: { type: "boolean", default: false } },
});
const [command, url] = positionals;

const user = () => loadUserData();
const ledgerOf = (dir: string) => new Ledger(join(dir, "ledger.jsonl"));

switch (command) {
  case "apply": {
    if (!url) throw new Error("usage: jh apply <url>");
    const u = user();
    const result = await apply({ url, user: u, ledger: ledgerOf(u.dir), approved: values.approve, headed: values.headed });
    if (result.outcome === "skipped") {
      console.log(`${result.key} is already ${result.state}; nothing to do.`);
      break;
    }
    console.log(`${result.key}: ${result.state}`);
    console.log(`evidence: ${result.runDir}`);
    for (const e of result.fillErrors) console.log(`  fill error: ${e}`);
    if (result.decision.decision === "hold") for (const r of result.decision.reasons) console.log(`  hold: ${r}`);
    break;
  }
  case "status": {
    for (const e of ledgerOf(user().dir).latest()) console.log(`${e.at}  ${e.state.padEnd(11)}  ${e.key}`);
    break;
  }
  case "pending": {
    for (const e of ledgerOf(user().dir).latest().filter((x) => x.state === "held" || x.state === "unconfirmed")) {
      console.log(`${e.key}  (${e.state})  ${e.runDir}`);
      const reasons = (e.detail as { reasons?: string[] } | undefined)?.reasons ?? [];
      for (const r of reasons) console.log(`  - ${r}`);
    }
    break;
  }
  case "doctor": {
    const u = user();
    console.log(`data dir   ${u.dir}`);
    console.log(`profile    ${u.profile.identity.firstName} ${u.profile.identity.lastName} <${u.profile.contact.email}>`);
    console.log(`resume     ${u.profile.documents.resume}`);
    console.log(`answers    ${u.bank.answers.length}`);
    console.log(`trust      ${u.config.trust}; auto-submit on [${u.config.autoSubmitAts.join(", ")}]; cap ${u.config.dailySubmitCap}/day`);
    const browser = await chromium.launch();
    console.log(`browser    chromium ${browser.version()}`);
    await browser.close();
    break;
  }
  default:
    console.log(USAGE);
}
