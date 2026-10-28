import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { loadUserData } from "./profile/load.ts";
import { apply } from "./run/apply.ts";
import type { JobKey } from "./domain/job.ts";
import { labelFrom, regressions, scoreEval } from "./discover/evalset.ts";
import { triage } from "./discover/triage.ts";
import { daily, scoreLatestAudit, writeReport } from "./org/coordinator.ts";
import { candidateFacts, discover } from "./run/discover.ts";
import { loadWatchlist } from "./sources/fetch.ts";
import { readCatalog } from "./store/catalog.ts";
import { Ledger } from "./store/ledger.ts";
import { ReviewList } from "./store/review.ts";
import { appendLabel, paths, readBaseline, readLabels, readTrust, writeBaseline, writeTrust } from "./store/state.ts";

const USAGE = `jh <command>

  apply <url> [--approve] [--headed]   fill, verify and (if the gate allows) submit one application
  discover [--inbox <dir>] [--only greenhouse,lever,ashby,workday,github,hn,gmail]
                                       fetch every source, merge into the catalog, triage, check links
  daily [--inbox <dir>]                coordinator run: discover, audit sample, approval queue, outreach, report
  report                               re-render the latest report and dashboard
  audit score <verdicts.jsonl> [--auditor <name>]
                                       score the independent auditor's blind verdicts; adjusts triage trust
  label <review-id|job-key> fit|not_fit [--note <text>]
                                       record your decision on a posting (feeds the eval set)
  eval [--record]                      score triage rules on your labels; fails if worse than the baseline
  trust [promote <stage>]              stage trust levels; promotion is yours to make
  status                               latest state of every application
  pending                              today's review list: held applications, matches to approve, questions
  doctor                               check the data directory and the browser`;

process.stdout.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EPIPE") process.exit(0);
  throw e;
});

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    approve: { type: "boolean", default: false },
    headed: { type: "boolean", default: false },
    inbox: { type: "string" },
    only: { type: "string" },
    auditor: { type: "string", default: "unnamed auditor" },
    note: { type: "string", default: "" },
    record: { type: "boolean", default: false },
  },
});
const [command, url, arg2] = positionals;

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
  case "discover": {
    const u = user();
    const r = await discover({
      dataDir: u.dir,
      watchlist: loadWatchlist(),
      facts: candidateFacts(u.profile),
      ...(values.inbox ? { inboxDir: values.inbox } : {}),
      ...(values.only ? { only: values.only.split(",") } : {}),
      log: (s) => console.error(s),
    });
    const seen = r.jobs.filter((j) => j.lastSeen >= r.startedAt);
    const count = (v: string) => seen.filter((j) => j.triage.verdict === v).length;
    console.log(`sightings ${r.sightings.length}; postings seen ${seen.length} (catalog ${r.jobs.length})`);
    console.log(`match ${count("match")}  review ${count("review")}  reject ${count("reject")}`);
    console.log(`sources ok ${r.outcomes.filter((o) => o.ok).length}, failed ${r.outcomes.filter((o) => !o.ok).length}`);
    console.log(`run ${r.runDir}`);
    break;
  }
  case "status": {
    for (const e of ledgerOf(user().dir).latest()) console.log(`${e.at}  ${e.state.padEnd(11)}  ${e.key}`);
    break;
  }
  case "pending": {
    const u = user();
    const held = ledgerOf(u.dir).latest().filter((x) => x.state === "held" || x.state === "unconfirmed");
    if (held.length) console.log(`Applications (${held.length})`);
    for (const e of held) {
      console.log(`  ${e.key}  (${e.state})  ${e.runDir}`);
      const reasons = (e.detail as { reasons?: string[] } | undefined)?.reasons ?? [];
      for (const r of reasons) console.log(`    - ${r}`);
    }
    const open = new ReviewList(paths(u.dir).review).open();
    const kinds = ["approve_match", "audit_disagreement", "question", "trust_change", "source_failure", "outreach_draft"] as const;
    for (const k of kinds) {
      const items = open.filter((i) => i.kind === k);
      if (!items.length) continue;
      console.log(`\n${k} (${items.length})`);
      for (const i of items) console.log(`  ${i.id}\n    ${i.subject}\n    ${i.detail}${i.link ? `\n    ${i.link}` : ""}`);
    }
    if (!held.length && !open.length) console.log("Nothing waiting on you.");
    break;
  }
  case "daily": {
    const r = await daily({ user: user(), watchlist: loadWatchlist(), ...(values.inbox ? { inboxDir: values.inbox } : {}), log: (s) => console.error(s) });
    const seen = r.jobs.filter((j) => j.lastSeen >= r.startedAt);
    const n = (v: string) => seen.filter((j) => j.triage.verdict === v).length;
    console.log(`postings seen ${seen.length}: match ${n("match")}, review ${n("review")}, reject ${n("reject")}`);
    console.log(`queued ${r.queued} for approval; audit sample ${r.auditSize}; outreach ${r.outreach.length} companies`);
    console.log(`report ${r.reportDir}/REPORT.md`);
    break;
  }
  case "report": {
    console.log(writeReport(user(), loadWatchlist()));
    break;
  }
  case "audit": {
    if (url !== "score" || !arg2) throw new Error("usage: jh audit score <verdicts.jsonl> [--auditor <name>]");
    const r = scoreLatestAudit(user(), loadWatchlist(), arg2, values.auditor);
    const p = (x: number | null) => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`);
    console.log(`false-match ${p(r.score.falseMatchRate)} (n=${r.score.matchJudged}); miss ${p(r.score.missRate)} (n=${r.score.rejectJudged}); near-miss ${p(r.score.nearMissRate)} (n=${r.score.nearJudged})`);
    console.log(`disagreements ${r.score.disagreements.length}; unanswered ${r.missing}; triage trust ${r.trust.state.level}${r.trust.demoted ? " (demoted)" : ""}`);
    break;
  }
  case "label": {
    const u = user();
    if (!url || (arg2 !== "fit" && arg2 !== "not_fit")) throw new Error("usage: jh label <review-id|job-key> fit|not_fit [--note <text>]");
    const review = new ReviewList(paths(u.dir).review);
    const key = (review.get(url) ? url.slice(url.indexOf(":") + 1) : url) as JobKey;
    const job = readCatalog(paths(u.dir).catalog).get(key);
    if (!job) throw new Error(`no posting ${key} in the catalog`);
    appendLabel(u.dir, labelFrom(job, arg2, values.note, new Date().toISOString()));
    for (const id of [`match:${key}`, `audit:${key}`]) if (review.get(id)?.status === "open") review.resolve(id, `${arg2}${values.note ? `: ${values.note}` : ""}`);
    console.log(`labeled ${key} ${arg2}`);
    break;
  }
  case "eval": {
    const u = user();
    const me = candidateFacts(u.profile);
    const score = scoreEval(readLabels(u.dir), (e) => triage(e, me));
    const baseline = readBaseline(u.dir);
    console.log(JSON.stringify(score));
    if (values.record) {
      writeBaseline(u.dir, score);
      console.log("baseline recorded");
    } else if (baseline) {
      const bad = regressions(score, baseline);
      for (const b of bad) console.log(`REGRESSION: ${b}`);
      if (bad.length) process.exitCode = 1;
    } else console.log("no baseline yet; record one with jh eval --record");
    break;
  }
  case "trust": {
    const u = user();
    const t = readTrust(u.dir);
    if (url === "promote") {
      const stage = arg2 as keyof typeof t;
      if (!t[stage]) throw new Error("usage: jh trust promote triage|apply|outreach");
      t[stage] = { ...t[stage], level: "auto", since: new Date().toISOString(), reason: "promoted by the candidate" };
      writeTrust(u.dir, t);
    }
    for (const [k, v] of Object.entries(t)) console.log(`${k.padEnd(9)} ${v.level.padEnd(8)} since ${v.since}  ${v.reason}; ${v.audits.length} audits`);
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
