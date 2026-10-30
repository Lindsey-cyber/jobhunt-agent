import { readFileSync } from "node:fs";
import { join } from "node:path";
import { queueQuestions } from "./store/questions.ts";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { loadUserData } from "./profile/load.ts";
import { apply, sameJob } from "./run/apply.ts";
import { excludedBy } from "./discover/exclude.ts";
import type { JobKey } from "./domain/job.ts";
import { labelFrom, regressions, scoreEval } from "./discover/evalset.ts";
import { triage } from "./discover/triage.ts";
import { runAuditor } from "./org/auditor.ts";
import { draftAnswers } from "./org/drafter.ts";
import { modelTriage } from "./org/triager.ts";
import { authUrl, fetchAlerts, finishAuth, gmailConfigured, recentHeaders } from "./sources/gmail.ts";
import { receiptFor } from "./verify/reconcile.ts";
import { daily, scoreLatestAudit, writeReport } from "./org/coordinator.ts";
import { candidateFacts, discover } from "./run/discover.ts";
import { serve } from "./run/serve.ts";
import { writeApplicationsPage } from "./run/applications.ts";
import { loadWatchlist } from "./sources/fetch.ts";
import { appendAnswer } from "./store/answerlog.ts";
import { readCatalog } from "./store/catalog.ts";
import { expectationFloor, payBelowExpectation } from "./discover/pay.ts";
import { tallyHolds } from "./verify/holds.ts";
import { Ledger } from "./store/ledger.ts";
import { ReviewList } from "./store/review.ts";
import { appendLabel, paths, readBaseline, readLabels, readLatest, readTrust, writeBaseline, writeTrust } from "./store/state.ts";

const USAGE = `jh <command>

  apply <url> [--approve] [--headed]   fill, verify and (if the gate allows) submit one application
  discover [--inbox <dir>] [--only greenhouse,lever,ashby,workday,github,hn,gmail]
                                       fetch every source, merge into the catalog, triage, check links
  daily [--inbox <dir>]                coordinator run: Gmail alerts (when authorized), discover, audit sample,
                                       approval queue, outreach, report
  gmail auth [--code <address>]        authorize read-only Gmail access (two steps; prints a consent link first)
  gmail fetch [--inbox <dir>]          save the last 30 days of job-alert emails
  report                               re-render the latest report and dashboard
  audit run [--model <id>]             have the API auditor (Anthropic or OpenAI, see JH_AUDIT_PROVIDER) judge
                                       the latest blind sample, then score it
  audit score <verdicts.jsonl> [--auditor <name>]
                                       score the independent auditor's blind verdicts; adjusts triage trust
  applications [--out <dir>]           page of every application: fields filled, read back, screenshot
  questions                            collect the questions holding applications into the review list, once each
  triage-model [--limit <n>]           a model judges postings the rules left at "review" (auditor's brief);
                                       yes → match, no → reject, unsure stays; default 300 a run
  holds                                why applications are held, grouped: needs your answer, site mechanics
                                       (for an engineering session), or held by design
  reconcile                            mark unconfirmed applications confirmed when the employer's receipt email arrived
  apply-approved [--limit <n>]         submit postings you approved (fit labels) that have an adapter, within the
                                       daily cap; skips excluded employers and anything already applied to
  draft                                draft answers to postings' own questions (why this role, have you built X)
                                       from the resume with OpenAI; every cited passage and number is checked
                                       against your documents before the answer is used
  label <review-id|job-key> fit|not_fit [--note <text>]
                                       record your decision on a posting (feeds the eval set)
  answer <review-id> <text>            record your answer to a question on the review list
  eval [--record]                      score triage rules on your labels; fails if worse than the baseline
  trust [promote <stage>]              stage trust levels; promotion is yours to make
  serve [--port <n>]                   dashboard, report and review list on 127.0.0.1 (default port 8787)
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
    model: { type: "string" },
    code: { type: "string" },
    port: { type: "string", default: "8787" },
    limit: { type: "string" },
    out: { type: "string" },
  },
});
const [command, url, arg2] = positionals;

const user = () => loadUserData();
const ledgerOf = (dir: string) => new Ledger(join(dir, "ledger.jsonl"));

const SAME_COMPANY_GAP_MS = 2 * 60_000;
// Workday submitted and confirmed on two employers (ADI, GlobalFoundries, 2026-10-29);
// JH_WORKDAY=off pauses it on a machine.
const WORKDAY_READY = process.env.JH_WORKDAY !== "off";
// Ashby answers automated submits with an image captcha (0 of 5 went through on
// 2026-10-29) and Lever always runs hCaptcha: a click there only leaves an
// unconfirmed application that can never be retried. They wait for the candidate
// unless JH_CAPTCHA_ATS=on (e.g. a run from her own browser).
const CAPTCHA_ATS = process.env.JH_CAPTCHA_ATS === "on";
// Round-robin over companies so two postings at one employer are never back to back.
function interleaveByCompany<T extends { company: string }>(jobs: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const j of jobs) groups.set(j.company, [...(groups.get(j.company) ?? []), j]);
  const out: T[] = [];
  while (out.length < jobs.length) for (const g of groups.values()) if (g.length) out.push(g.shift()!);
  return out;
}

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
      exclude: u.search.excludeCompanies,
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
  case "applications": {
    const u = user();
    // --out <dir> copies screenshots beside the page (to publish it); the default in docs/applications links to data/evidence.
    const out = values.out ?? join(u.dir, "..", "docs", "applications");
    console.log(await writeApplicationsPage(ledgerOf(u.dir), out, { dataDir: u.dir, copyShots: Boolean(values.out) }));
    break;
  }
  case "questions": {
    const u = user();
    const n = queueQuestions(ledgerOf(u.dir), new ReviewList(paths(u.dir).review));
    console.log(`${n} distinct questions hold applications; see jh pending and answer with jh answer <id> <text>`);
    break;
  }
  case "apply-approved": {
    const u = user();
    const ledger = ledgerOf(u.dir);
    const catalog = readCatalog(paths(u.dir).catalog);
    const labels = new Map(readLabels(u.dir).map((l) => [l.key, l]));
    const fit = [...labels.values()].filter((l) => l.label === "fit");
    // Triage promoted to auto (by the candidate, jh trust promote triage): every
    // current match counts as approved too, unless she labeled it not_fit.
    const auto = readTrust(u.dir).triage.level === "auto";
    const matched = auto ? [...catalog.values()].filter((j) => j.triage?.verdict === "match" && labels.get(j.key)?.label !== "not_fit").sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "")) : [];
    const ready = [...new Set([...fit.map((l) => l.key as JobKey), ...matched.map((j) => j.key)])]
      .map((k) => catalog.get(k))
      .filter((j): j is NonNullable<typeof j> => Boolean(j) && (j!.key.startsWith("greenhouse:") || (CAPTCHA_ATS && /^(lever|ashby):/.test(j!.key)) || (WORKDAY_READY && j!.key.startsWith("workday:"))) && !excludedBy(j!.company, u.search.excludeCompanies) && j!.link?.status !== "invalid")
      // The candidate (2026-10-30): pay that tops out at or below her range's low end is not applied to.
      .filter((j) => {
        if (!payBelowExpectation(j.description ?? "", expectationFloor(u.profile.salaryExpectation))) return true;
        if (labels.get(j.key)?.label !== "not_fit") appendLabel(u.dir, labelFrom(j, "not_fit", "pay tops out below her expected range", new Date().toISOString(), "bulk"));
        return false;
      })
      .filter((j) => {
        const prior = sameJob(ledger, j.url);
        if (!prior) return true;
        if (!ledger.canStart(prior.key)) return false;
        // Held only on something the candidate must sign: a rerun cannot change it.
        const last = ledger.history(prior.key).at(-1);
        const reasons = ((last?.detail as { reasons?: string[] } | undefined)?.reasons ?? []).filter((r) => !/trust level|autoSubmitAts|low confidence|generated answer/.test(r));
        // (The signed field is also reported empty after filling; that is the same hold.)
        const signed = reasons.filter((r) => /legal attestations need the candidate/.test(r)).map((r) => /^required "(.+?)":/.exec(r)?.[1]);
        const rest = reasons.filter((r) => !/legal attestations need the candidate/.test(r) && !signed.some((l) => l && r === `required "${l}" is empty after filling`));
        return !(last?.state === "held" && signed.length > 0 && rest.length === 0);
      });
    const limit = Number(values.limit ?? u.config.dailySubmitCap);
    console.log(`${ready.length} ${auto ? "approved or matched" : "approved"} postings with an adapter are not yet applied to; trying up to ${limit}`);
    // The candidate (2026-10-29): never several applications to one company at once.
    // Interleave companies, and leave two minutes between submissions to the same one.
    // Postings never tried go first; retries of held ones after them.
    const fresh = ready.filter((j) => !sameJob(ledger, j.url));
    const retries = ready.filter((j) => sameJob(ledger, j.url));
    const order = [...interleaveByCompany(fresh), ...interleaveByCompany(retries)].slice(0, limit);
    const lastAt = new Map<string, number>();
    for (const j of order) {
      if (ledger.submittedOn(new Date().toISOString().slice(0, 10)) >= u.config.dailySubmitCap) break;
      const wait = (lastAt.get(j.company) ?? 0) + SAME_COMPANY_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        const r = await apply({ url: j.url, user: u, ledger, approved: true, job: { company: j.company, title: j.title, location: j.location } });
        if (r.state === "submitted" || r.state === "confirmed" || r.state === "unconfirmed") lastAt.set(j.company, Date.now());
        console.log(`${j.company} · ${j.title}: ${r.state}${r.outcome === "done" && r.decision.decision === "hold" ? ` (${r.decision.reasons[0]})` : ""}`);
      } catch (e) {
        const message = (e as Error).message.split("\n")[0]!;
        console.log(`${j.company} · ${j.title}: error ${message}`);
        // A closed posting leaves the queue for good.
        if (/the posting is closed/.test(message)) appendLabel(u.dir, labelFrom(j, "not_fit", "posting closed", new Date().toISOString(), "bulk"));
      }
    }
    queueQuestions(ledger, new ReviewList(paths(u.dir).review));
    break;
  }
  case "draft": {
    const u = user();
    const out = await draftAnswers(u, ledgerOf(u.dir), (s) => console.error(s));
    const used = out.filter((o) => o.answer && !o.problems.length);
    console.log(`${used.length} of ${out.length} questions drafted and checked; the rest stay on the review list`);
    for (const o of out) console.log(`${o.problems.length ? "HELD" : "USED"}  ${o.company} · ${o.question}${o.answer ? `\n      ${o.answer}` : ""}${o.problems.length ? `\n      ${o.problems.join("; ")}` : ""}`);
    break;
  }
  case "triage-model": {
    const r = await modelTriage(user(), { limit: Number(values.limit ?? 300), log: (s) => console.error(s) });
    console.log(`model triage (${r.model}): judged ${r.judged}: ${r.yes} fit → match, ${r.no} not fit → reject, ${r.unsure} unsure`);
    break;
  }
  case "reconcile": {
    // Applications left unconfirmed whose employer has since emailed a receipt become confirmed.
    const u = user();
    const ledger = ledgerOf(u.dir);
    const open = ledger.latest().filter((e) => e.state === "unconfirmed");
    if (!open.length || !gmailConfigured()) {
      console.log(open.length ? "Gmail is not authorized; nothing checked" : "no unconfirmed applications");
      break;
    }
    const mail = await recentHeaders("newer_than:30d -in:sent (subject:application OR subject:applying OR subject:applied)", 400);
    for (const e of open) {
      const submitted = ledger.history(e.key).findLast((x) => x.state === "submitted")?.at ?? e.at;
      const plan = (() => {
        try {
          return JSON.parse(readFileSync(join(e.runDir, "plan.json"), "utf8")) as { form?: { company?: string } };
        } catch {
          return {};
        }
      })();
      const company = plan.form?.company ?? "";
      const hit = company ? receiptFor(company, submitted, mail) : undefined;
      if (!hit) {
        console.log(`still unconfirmed: ${e.key}${company ? ` (${company})` : ""}`);
        continue;
      }
      ledger.transition(e.key, "confirmed", e.runDir, { email: hit });
      console.log(`confirmed by email: ${company}: "${hit.subject}" (${hit.date})`);
    }
    break;
  }
  case "holds": {
    const u = user();
    const held = ledgerOf(u.dir).latest().filter((e) => e.state === "held");
    const entries = held.map((e) => {
      const verify = (() => {
        try {
          return JSON.parse(readFileSync(join(e.runDir, "verify.json"), "utf8")) as { fillErrors?: string[] };
        } catch {
          return {};
        }
      })();
      const reasons = [...((e.detail as { reasons?: string[] } | undefined)?.reasons ?? []), ...(verify.fillErrors ?? []).map((f) => `fill error: ${f.split("\n")[0]}`)];
      return { key: e.key, reasons };
    });
    const tally = tallyHolds(entries);
    for (const cause of ["mechanic", "answer", "by_design"] as const) {
      const rows = tally.filter((t) => t.cause === cause);
      if (!rows.length) continue;
      console.log(`\n${{ mechanic: "Site mechanics (engineering)", answer: "Needs your answer (jh pending)", by_design: "Held by design (yours to finish)" }[cause]}`);
      for (const t of rows) console.log(`  ${String(t.count).padStart(3)}  ${t.reason}\n       e.g. ${t.examples.join(", ")}`);
    }
    console.log(`\n${held.length} held applications`);
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
    const kinds = ["submit_by_hand", "approve_match", "audit_disagreement", "question", "trust_change", "source_failure", "drafted_answer", "outreach_draft"] as const;
    for (const k of kinds) {
      const items = open.filter((i) => i.kind === k);
      if (!items.length) continue;
      console.log(`\n${k} (${items.length})`);
      for (const i of items) console.log(`  ${i.id}\n    ${i.subject}\n    ${i.detail}${i.link ? `\n    ${i.link}` : ""}`);
    }
    if (!held.length && !open.length) console.log("Nothing waiting on you.");
    break;
  }
  case "gmail": {
    if (url === "auth" && !values.code) {
      console.log(`1. Open this link, sign in as the candidate and allow read-only Gmail access:\n\n${authUrl()}\n`);
      console.log("2. The browser then fails to open a localhost page. Copy that page's full address and run:\n   jh gmail auth --code '<address>'");
    } else if (url === "auth") {
      console.log(`authorized; refresh token saved to ${await finishAuth(values.code!)}`);
    } else if (url === "fetch") {
      const dir = values.inbox ?? join(user().dir, "inbox", new Date().toISOString().slice(0, 10));
      console.log(`saved ${(await fetchAlerts(dir)).saved} messages to ${dir}`);
    } else throw new Error("usage: jh gmail auth [--code <address>] | jh gmail fetch [--inbox <dir>]");
    break;
  }
  case "daily": {
    const u = user();
    let inbox = values.inbox;
    if (!inbox && gmailConfigured()) {
      inbox = join(u.dir, "inbox", new Date().toISOString().slice(0, 10));
      console.error(`gmail: saved ${(await fetchAlerts(inbox)).saved} alert emails to ${inbox}`);
    }
    const r = await daily({ user: u, watchlist: loadWatchlist(), ...(inbox ? { inboxDir: inbox } : {}), log: (s) => console.error(s) });
    const seen = r.jobs.filter((j) => j.lastSeen >= r.startedAt);
    const n = (v: string) => seen.filter((j) => j.triage.verdict === v).length;
    console.log(`postings seen ${seen.length}: match ${n("match")}, review ${n("review")}, reject ${n("reject")}`);
    console.log(`queued ${r.queued} for approval; audit sample ${r.auditSize} in ${r.auditDir}; outreach ${r.outreach.length} companies`);
    console.log(`report ${r.reportDir}/REPORT.md`);
    break;
  }
  case "serve": {
    serve(user().dir, Number(values.port));
    console.log(`serving on http://127.0.0.1:${values.port}`);
    break;
  }
  case "report": {
    console.log(writeReport(user(), loadWatchlist()));
    break;
  }
  case "audit": {
    let verdicts = arg2;
    let auditor = values.auditor;
    if (url === "run") {
      const latest = readLatest(user().dir);
      if (!latest) throw new Error("no discovery run yet; run jh daily first");
      const run = await runAuditor(latest.auditDir, values.model, (s) => console.error(s));
      console.log(`verdicts ${run.path}: ${run.answered} answered, ${run.missing.length} recorded as unsure`);
      verdicts = run.path;
      auditor = `${run.model} via the ${run.provider === "openai" ? "OpenAI" : "Claude"} API, blind, brief + postings only`;
    } else if (url !== "score" || !arg2) throw new Error("usage: jh audit run [--model <id>] | jh audit score <verdicts.jsonl> [--auditor <name>]");
    const r = scoreLatestAudit(user(), loadWatchlist(), verdicts!, auditor);
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
    if (job.official && !job.description) console.error(`warning: ${key} has no description in the catalog; its label will hold the title only. Label it again after the next jh daily.`);
    appendLabel(u.dir, labelFrom(job, arg2, values.note, new Date().toISOString()));
    for (const id of [`match:${key}`, `audit:${key}`]) if (review.get(id)?.status === "open") review.resolve(id, `${arg2}${values.note ? `: ${values.note}` : ""}`);
    console.log(`labeled ${key} ${arg2}`);
    break;
  }
  case "answer": {
    if (!url || !arg2) throw new Error("usage: jh answer <review-id> <text>");
    const u = user();
    const review = new ReviewList(paths(u.dir).review);
    const item = review.get(url);
    if (item?.status !== "open") throw new Error(`no open review item ${url}`);
    // A form question: the answer goes into the answer log, reused on every form.
    if (url.startsWith("question:form:")) appendAnswer(u.dir, { id: url.slice("question:".length), question: item.subject, aliases: [], answer: arg2, origin: "human" });
    // A drafted answer the candidate rewrites: her text replaces the draft.
    if (url.startsWith("answer:draft:")) {
      const id = url.slice("answer:".length);
      const draft = u.bank.answers.find((a) => a.id === id);
      if (!draft) throw new Error(`no drafted answer ${id}`);
      const { evidence: _, ...rest } = draft;
      appendAnswer(u.dir, { ...rest, answer: arg2, origin: "human" });
    }
    review.resolve(url, arg2);
    console.log(`answered ${url}`);
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
