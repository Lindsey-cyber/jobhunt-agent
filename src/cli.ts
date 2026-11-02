import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildPlan } from "./plan/plan.ts";
import { dirname, join } from "node:path";
import { queueQuestions } from "./store/questions.ts";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { loadUserData } from "./profile/load.ts";
import { apply, sameJob } from "./run/apply.ts";
import { employerKey, sponsorVerdict } from "./discover/h1b.ts";
import { postedOn } from "./discover/eligibility.ts";
import { fitOf } from "./discover/fit.ts";
import { agentQueue, applicationIndex, postings, renderToday, type Blocker } from "./discover/today.ts";
import { factSheet, type QuestionMapping } from "./plan/facts.ts";
import { normalize } from "./plan/text.ts";
import { lookupH1b } from "./sources/h1b.ts";
import { pool } from "./sources/http.ts";
import { readH1b, writeH1b } from "./store/h1b.ts";
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
import { readModelVerdicts } from "./store/modelverdicts.ts";
import { retriage } from "./discover/merge.ts";
import { expectationFloor } from "./discover/pay.ts";
import { tallyHolds } from "./verify/holds.ts";
import { readCoverage } from "./store/coverage.ts";
import { stageGates } from "./discover/gates.ts";
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
    list: { type: "boolean", default: false },
    refresh: { type: "boolean", default: false },
    since: { type: "string" },
    from: { type: "string" },
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

// Every posting's one state (src/discover/today.ts), shared by jh today, apply-approved and facts-map.
// The source registry does not exist yet (W4): until it does, gate 1a fails on it.
function gatesOf(u: ReturnType<typeof user>, w: ReturnType<typeof gather>) {
  return stageGates({
    ...(({ coverage, problem }) => ({ coverage, coverageProblem: problem }))(readCoverage(u.dir)),
    registry: undefined,
    today: w.today,
    matches: [...w.catalog.values()].filter((j) => j.triage?.verdict === "match"),
    audit: readTrust(u.dir).triage.audits.at(-1),
  });
}

function gather(u: ReturnType<typeof user>) {
  const ledger = ledgerOf(u.dir);
  // Today's rules over the whole catalog: a posting no source re-listed still carries the verdict of the rules it was last triaged under.
  const catalog = new Map(retriage(readCatalog(paths(u.dir).catalog).values(), candidateFacts(u.profile), u.search.excludeCompanies, readModelVerdicts(u.dir)).map((j) => [j.key, j]));
  const h1b = readH1b(u.dir);
  const today = new Date().toISOString().slice(0, 10);
  const policy = u.search;
  const blockersOf = (app: { key: string }) => {
    const runDir = ledger.history(app.key as Parameters<typeof ledger.history>[0]).at(-1)?.runDir;
    if (!runDir || !existsSync(`${runDir}/plan.json`)) return undefined;
    const plan = buildPlan(JSON.parse(readFileSync(`${runDir}/plan.json`, "utf8")).form, u.profile, u.bank);
    return plan.items.filter((it) => it.field.required && it.status === "blocked").map((it) => it.field.label);
  };
  const input = { jobs: catalog.values(), labels: new Map(readLabels(u.dir).map((l) => [l.key, l.label])), apps: applicationIndex(ledger.latest()), h1b, policy, payFloor: expectationFloor(u.profile.salaryExpectation), today, blockersOf };
  const posts = postings(input);
  const tierOfJob = (j: { company: string; title: string; description: string }) => fitOf(j, policy, h1b.get(employerKey(j.company))).tier;
  const tierOf = (p: { job: { company: string; title: string; description: string } }) => tierOfJob(p.job);
  return { ledger, catalog, h1b, today, policy, input, posts, tierOf, tierOfJob, queue: agentQueue(posts, policy, today, tierOf) };
}

switch (command) {
  case "apply": {
    if (!url) throw new Error("usage: jh apply <url>");
    const u = user();
    const result = await apply({ url, user: u, ledger: ledgerOf(u.dir), approved: values.approve, headed: values.headed, stageGate: gatesOf(u, gather(u))["1c"] });
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
  case "facts-map": {
    // Answering from facts: --out DIR exports every question that holds an eligible application, with
    // her fact sheet; a model maps each to one fact; --from FILE records the mappings in data/question-map.jsonl.
    const u = user();
    const mapFile = join(u.dir, "question-map.jsonl");
    if (values.from) {
      const items = new Map(readFileSync(join(dirname(values.from), "items.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => { const i = JSON.parse(l); return [i.id, i]; }));
      const at = new Date().toISOString();
      const rows: QuestionMapping[] = [];
      for (const l of readFileSync(values.from, "utf8").split("\n").filter(Boolean)) {
        const v = JSON.parse(l); const i = items.get(v.id);
        if (!i || !v.fact || v.fact === "none") continue;
        rows.push({ question: i.question, ...(i.options?.length ? { options: i.options } : {}), fact: v.fact, answer: String(v.answer ?? ""), reason: String(v.reason ?? "").slice(0, 300), by: values.model ?? "model", at });
      }
      appendFileSync(mapFile, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
      const loaded = user().bank.answers.filter((a) => a.origin === "fact").length;
      console.log(`recorded ${rows.length} mappings; ${loaded} fact answers load (mappings citing no fact or a choice not offered are dropped)`);
      break;
    }
    const out = values.out ?? join(".scratch", "facts-map");
    const ledger = ledgerOf(u.dir);
    const catalog = readCatalog(paths(u.dir).catalog);
    const today = new Date().toISOString().slice(0, 10);
    const posts = postings({ jobs: catalog.values(), labels: new Map(readLabels(u.dir).map((l) => [l.key, l.label])), apps: applicationIndex(ledger.latest()), h1b: readH1b(u.dir), policy: u.search, payFloor: expectationFloor(u.profile.salaryExpectation), today });
    const qs = new Map<string, { id: string; question: string; kind: string; options: string[]; companies: string[] }>();
    for (const p of posts) {
      if (p.state !== "held" || !p.app) continue;
      const runDir = ledger.history(p.app.key as Parameters<typeof ledger.history>[0]).at(-1)?.runDir;
      if (!runDir || !existsSync(`${runDir}/plan.json`)) continue;
      const plan = buildPlan(JSON.parse(readFileSync(`${runDir}/plan.json`, "utf8")).form, u.profile, u.bank);
      for (const it of plan.items) {
        if (!it.field.required || it.status !== "blocked") continue;
        const k = `${normalize(it.field.label)}|${it.field.options.join("|")}`;
        const q = qs.get(k) ?? { id: `q${qs.size + 1}`, question: it.field.label, kind: it.field.kind, options: it.field.options, companies: [] };
        q.companies.push(p.job.company);
        qs.set(k, q);
      }
    }
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "items.jsonl"), [...qs.values()].map((q) => JSON.stringify(q)).join("\n") + "\n");
    writeFileSync(join(out, "facts.md"), factSheet(u.profile, u.bank).map((f) => `- \`${f.id}\` (${f.about}) = ${f.value}`).join("\n") + "\n");
    console.log(`${qs.size} distinct questions hold eligible applications; wrote ${out}/items.jsonl and ${out}/facts.md`);
    break;
  }
  case "today": {
    // The candidate's daily page: every posting's one state, her to-dos ranked by what they unblock.
    const u = user();
    const w = gather(u);
    const blockers: Blocker[] = w.posts.filter((p) => p.state === "held").flatMap((p) => (p.blockers ?? []).map((question) => ({ company: p.job.company, title: p.job.title, question })));
    const appliedToday = [...new Map(w.posts.filter((p) => p.app && ["submitted", "confirmed", "unconfirmed"].includes(p.app.state) && p.app.at.slice(0, 10) === w.today).map((p) => [p.app!.key, p])).values()];
    const pendingFile = join("docs", "pending-decisions.md");
    const md = renderToday({ ...w.input, posts: w.posts, blockers, appliedToday, tierOf: w.tierOf, queueSize: w.queue.length, gates: gatesOf(u, w), pending: existsSync(pendingFile) ? readFileSync(pendingFile, "utf8") : undefined });
    const out = join("docs", "today", `${w.today}.md`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, md);
    writeFileSync(join("docs", "TODAY.md"), md);
    console.log(`wrote ${out} (and docs/TODAY.md)`);
    break;
  }
  case "h1b": {
    // Looks up H-1B history for every company in the approved pool (read-only, cached in data/h1b).
    const u = user();
    const catalog = readCatalog(paths(u.dir).catalog);
    const latest = new Map(readLabels(u.dir).map((l) => [l.key, l]));
    // Every approved posting's company, and every current match of any age (age only orders applying).
    const matched = [...catalog.values()].filter((j) => j.triage?.verdict === "match").map((j) => j.company);
    const companies = [...new Set([...matched, ...[...latest.values()].filter((l) => l.label === "fit").map((l) => catalog.get(l.key as JobKey)?.company)].filter((c): c is string => Boolean(c)))];
    const h1b = readH1b(u.dir);
    const todo = companies.filter((c) => values.refresh || !h1b.has(employerKey(c)));
    console.log(`${companies.length} companies in the approved pool; looking up ${todo.length}`);
    const at = new Date().toISOString();
    let done = 0;
    await pool(todo, 3, async (c) => {
      try { const r = await lookupH1b(c, at); h1b.set(employerKey(c), r); } catch (e) { console.error(`h1b lookup failed for ${c}: ${String(e).slice(0, 120)}`); }
      if (++done % 25 === 0) { writeH1b(u.dir, h1b); console.log(`${done}/${todo.length}`); }
    });
    writeH1b(u.dir, h1b);
    const v = companies.map((c) => sponsorVerdict(h1b.get(employerKey(c))));
    console.log(`sponsor ${v.filter((x) => x === "sponsor").length}, no filings ${v.filter((x) => x === "none").length}, not looked up ${v.filter((x) => x === "unknown").length}`);
    break;
  }
  case "apply-approved": {
    // Runs the agent's queue from the same state model as docs/TODAY.md (src/discover/today.ts).
    const u = user();
    const w = gather(u);
    const gates = gatesOf(u, w);
    if (!gates["1c"].pass) {
      console.log("apply-approved refused: the stage gates have not passed (1a search complete, 1b screening accurate).");
      for (const g of ["1a", "1b"] as const) for (const c of gates[g].checks.filter((c) => !c.pass)) console.log(`  ${g} ✗ ${c.name}: ${c.value}`);
      break;
    }
    const ledger = w.ledger;
    const limit = Number(values.limit ?? u.config.dailySubmitCap);
    const adapter = (k: string) => k.startsWith("greenhouse:") || (CAPTCHA_ATS && /^(lever|ashby):/.test(k)) || (WORKDAY_READY && k.startsWith("workday:"));
    // --since YYYY-MM-DD: only postings published on or after that day.
    const queue = w.queue.filter((p) => adapter(p.job.key) && (!values.since || postedOn(p.job) >= values.since));
    const fresh = queue.filter((p) => !p.app).map((p) => p.job);
    const retries = queue.filter((p) => p.app).map((p) => p.job);
    console.log(`agent queue: ${fresh.length} never tried, ${retries.length} held ones today's rules now fully answer; trying up to ${limit}`);
    // The candidate (2026-10-29): never several applications to one company at once.
    // Interleave companies, and leave two minutes between submissions to the same one.
    const order = [...interleaveByCompany(fresh), ...interleaveByCompany(retries)].slice(0, limit);
    if (values.list) {
      for (const [i, j] of order.entries()) console.log(`${String(i + 1).padStart(3)}. ${w.tierOfJob(j)}  ${postedOn(j) || "no date   "}  ${retries.includes(j) ? "retry" : "new  "}  ${j.company} · ${j.title}`);
      break;
    }
    const lastAt = new Map<string, number>();
    for (const j of order) {
      if (ledger.submittedOn(new Date().toISOString().slice(0, 10)) >= u.config.dailySubmitCap) break;
      const wait = (lastAt.get(j.company) ?? 0) + SAME_COMPANY_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        const r = await apply({ url: j.url, user: u, ledger, approved: true, stageGate: gates["1c"], job: { company: j.company, title: j.title, location: j.location } });
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
