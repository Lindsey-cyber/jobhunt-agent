// The coordinator only schedules and summarizes. Each manager owns one pipeline;
// its workers are code where code can decide, and its verifier is independent.
//
//   coordinator.daily()
//   ├─ discoveryManager   worker: src/run/discover.ts   verifier: blind triage audit
//   ├─ applyManager       phase 1: queues matches for the candidate's approval
//   └─ outreachManager    collects small-company openings and drafts, never sends
//
// In a cloud session the auditor is a separate agent on another model given only
// audit/blind.jsonl and audit/brief.md; on the VPS it will be an API call with
// the same two files. Either way code scores it against the hidden answer key.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JobKey, Sighting } from "../domain/job.ts";
import { auditorBrief, drawSample, scoreAudit, type AnswerKeyItem, type AuditScore, type AuditVerdict } from "../discover/audit.ts";
import { channelMetrics, jobsCsv, priority, toCsv } from "../discover/metrics.ts";
import { outreachQueue, type OutreachEntry } from "../discover/outreach.ts";
import { dashboardHtml, reportMarkdown, type ReportData } from "../discover/render.ts";
import { recordAudit } from "../discover/stagetrust.ts";
import type { UserData } from "../profile/load.ts";
import { candidateFacts, discover, readInbox } from "../run/discover.ts";
import type { SourceOutcome, Watchlist } from "../sources/fetch.ts";
import { readCatalog } from "../store/catalog.ts";
import { ReviewList } from "../store/review.ts";
import { paths, readLatest, readTrust, writeLatest, writeTrust } from "../store/state.ts";

const APPROVALS_PER_DAY = 40;

export interface DailyOptions {
  user: UserData;
  watchlist: Watchlist;
  inboxDir?: string;
  reportRoot?: string;
  log?: (s: string) => void;
}

export async function daily(o: DailyOptions) {
  const log = o.log ?? (() => {});
  const dir = o.user.dir;
  log("coordinator: discovery manager");
  const r = await discover({ dataDir: dir, watchlist: o.watchlist, facts: candidateFacts(o.user.profile), exclude: o.user.search.excludeCompanies, ...(o.inboxDir ? { inboxDir: o.inboxDir } : {}), log });
  const reportDir = join(o.reportRoot ?? "docs/reports", r.startedAt.slice(0, 10));
  // One audit dir per run, so a second run on the same day keeps the first audit.
  const auditDir = join(reportDir, "audit", r.startedAt.slice(11, 19).replace(/:/g, ""));
  mkdirSync(auditDir, { recursive: true });
  const review = new ReviewList(paths(dir).review);
  const seen = r.jobs.filter((j) => j.lastSeen >= r.startedAt);

  // Discovery verifier: blind sample now, scored once the auditor answers.
  const seed = Date.parse(r.startedAt) % 2 ** 31;
  const { blind, key } = drawSample(seen, seed);
  writeFileSync(join(auditDir, "blind.jsonl"), blind.map((b) => JSON.stringify(b)).join("\n") + "\n");
  writeFileSync(join(auditDir, "brief.md"), auditorBrief(o.user.profile) + "\n");
  // The answer key stays out of the report dir until scoring, so an auditor
  // pointed at that dir cannot read it.
  writeFileSync(join(r.runDir, "audit-key.json"), JSON.stringify(key, null, 2));
  log(`coordinator: audit sample of ${blind.length} written to ${auditDir}`);

  // Apply manager, phase 1: the best matches go to the candidate for approval.
  // Approvals and rejections become the labeled eval set.
  const trust = readTrust(dir);
  const ready = seen.filter((j) => j.triage.verdict === "match" && j.official && j.link?.status !== "invalid").sort(priority);
  const byKey = new Map(seen.map((j) => [`match:${j.key}`, j]));
  for (const item of review.open().filter((i) => i.kind === "approve_match")) {
    const j = byKey.get(item.id);
    if (j && j.triage.verdict !== "match") review.resolve(item.id, `withdrawn: no longer a match after a rule change (${j.triage.rule})`);
  }
  const today = r.startedAt.slice(0, 10);
  let queued = 0;
  const already = review.open().filter((i) => i.kind === "approve_match" && i.at.startsWith(today)).length;
  for (const j of ready) {
    if (already + queued >= APPROVALS_PER_DAY) break;
    if (review.add({ id: `match:${j.key}`, kind: "approve_match", subject: `${j.company} · ${j.title}`, detail: `${j.location} — ${j.triage.reason}${j.publishedAt ? `; published ${j.publishedAt.slice(0, 10)}` : ""}`, link: j.url })) queued++;
  }
  log(`coordinator: apply manager queued ${queued} matches for approval (triage trust: ${trust.triage.level})`);

  // Outreach manager.
  const outreach = outreachQueue(seen, o.user.profile, r.startedAt);
  for (const e of outreach.filter((x) => x.publicContacts.length)) {
    review.add({ id: `outreach:${e.company.toLowerCase()}`, kind: "outreach_draft", subject: `${e.company}: draft ready, contact ${e.publicContacts.map((c) => c.value).join(", ")}`, detail: e.confidenceNote, link: e.hiringPosts[0]?.url ?? e.roles[0]?.url ?? "" });
  }

  // Scope questions only the candidate can settle; asked once, never re-asked.
  const ds = seen.filter((j) => j.triage.rule === "role.data_science").length;
  if (ds) {
    review.add({
      id: "question:scope:data_science",
      kind: "question",
      subject: `Should Data Scientist roles without ML in the title count as matches? (${ds} today in review)`,
      detail: "Today they sit in review. Answer yes or no; the rule and its test change to match, and your label decisions on a few of them seed the eval set.",
    });
  }

  const two = seen.filter((j) => j.triage.rule === "experience.two_years").length;
  if (two) {
    review.add({
      id: "question:scope:two_year_minimum",
      kind: "question",
      subject: `Should postings that require at least 2 years of experience count as matches? (${two} today in review)`,
      detail: "The blind auditor judged them not new-grad roles; your 0-2 year target could include them. Answer yes or no.",
    });
  }

  for (const f of r.outcomes.filter((x) => !x.ok)) {
    review.refresh({ id: `source:${f.channel}:${f.name}`, kind: "source_failure", subject: `${f.name} failed`, detail: f.error ?? "", link: f.url });
  }

  writeLatest(dir, { runDir: r.runDir, reportDir, auditDir, startedAt: r.startedAt, finishedAt: r.finishedAt, inboxMessages: o.inboxDir ? readInbox(o.inboxDir).length : 0, auditSeed: seed });
  writeReport(o.user, o.watchlist);
  return { ...r, reportDir, auditDir, auditSize: blind.length, queued, outreach };
}

// Verifier step: score the auditor's verdicts, adjust stage trust, and put every
// disagreement on the review list for the candidate to settle.
export function scoreLatestAudit(user: UserData, watchlist: Watchlist, verdictsPath: string, auditor: string) {
  const latest = readLatest(user.dir);
  if (!latest) throw new Error("no discovery run yet; run jh daily first");
  const key = JSON.parse(readFileSync(join(latest.runDir, "audit-key.json"), "utf8")) as AnswerKeyItem[];
  const verdicts = readFileSync(verdictsPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as AuditVerdict);
  const missing = key.filter((k) => !verdicts.some((v) => v.id === k.id));
  const score = scoreAudit(key, verdicts);
  const at = new Date().toISOString();
  writeFileSync(join(latest.auditDir, "verdicts.jsonl"), verdicts.map((v) => JSON.stringify(v)).join("\n") + "\n");
  copyFileSync(join(latest.runDir, "audit-key.json"), join(latest.auditDir, "answer-key.json"));
  writeFileSync(join(latest.auditDir, "score.json"), JSON.stringify({ at, auditor, sampleSize: key.length, missing: missing.map((m) => m.id), score }, null, 2));

  const trust = readTrust(user.dir);
  const result = recordAudit(trust.triage, score, at);
  trust.triage = result.state;
  writeTrust(user.dir, trust);
  const review = new ReviewList(paths(user.dir).review);
  const catalog = readCatalog(paths(user.dir).catalog);
  for (const d of score.disagreements) {
    const j = catalog.get(d.key as JobKey);
    review.add({
      id: `audit:${d.key}`,
      kind: "audit_disagreement",
      subject: `${j?.company ?? ""} · ${j?.title ?? d.key}: rules say ${d.verdict} (${d.rule}), auditor says ${d.fit === "yes" ? "fit" : "not fit"}`,
      detail: d.reason,
      link: j?.url ?? "",
    });
  }
  if (result.demoted) review.add({ id: `trust:triage:${at}`, kind: "trust_change", subject: "Triage demoted to confirm", detail: result.state.reason });
  if (result.promotable) review.add({ id: `trust:triage:promotable:${at}`, kind: "trust_change", subject: "Triage qualifies for auto (3 clean audits)", detail: "Run `jh trust promote triage` if you agree." });
  writeReport(user, watchlist);
  return { score, missing: missing.length, trust: result };
}

export function writeReport(user: UserData, watchlist: Watchlist) {
  const latest = readLatest(user.dir);
  if (!latest) throw new Error("no discovery run yet");
  const catalog = readCatalog(paths(user.dir).catalog);
  const jobs = [...catalog.values()];
  const sightings = readFileSync(join(latest.runDir, "sightings.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Sighting);
  const outcomes = JSON.parse(readFileSync(join(latest.runDir, "outcomes.json"), "utf8")) as SourceOutcome[];
  const scorePath = join(latest.auditDir, "score.json");
  const audit = existsSync(scorePath) ? (JSON.parse(readFileSync(scorePath, "utf8")) as { at: string; auditor: string; sampleSize: number; score: AuditScore }) : undefined;
  const seen = jobs.filter((j) => j.lastSeen >= latest.startedAt);
  const outreach: OutreachEntry[] = outreachQueue(seen, user.profile, latest.startedAt);
  const data: ReportData = {
    generatedAt: new Date().toISOString(),
    runStartedAt: latest.startedAt,
    runFinishedAt: latest.finishedAt,
    runDir: latest.runDir,
    trust: user.config.trust,
    jobs,
    sightings: sightings.length,
    channels: channelMetrics(sightings, catalog, latest.startedAt),
    outcomes,
    skipped: watchlist.skipped,
    ...(audit ? { audit } : {}),
    stage: readTrust(user.dir).triage,
    outreach,
    inboxMessages: latest.inboxMessages,
    pending: Object.entries(Object.groupBy(new ReviewList(paths(user.dir).review).open(), (i) => i.kind)).map(([kind, xs]) => ({ kind, count: xs?.length ?? 0 })),
  };
  const d = latest.reportDir;
  mkdirSync(d, { recursive: true });
  const sorted = seen.filter((j) => !j.key.startsWith("lead:")).sort(priority);
  writeFileSync(join(d, "REPORT.md"), reportMarkdown(data));
  writeFileSync(join(d, "dashboard.html"), dashboardHtml(data));
  writeFileSync(join(d, "matches.csv"), jobsCsv(sorted.filter((j) => j.triage.verdict === "match")));
  writeFileSync(join(d, "review.csv"), jobsCsv(sorted.filter((j) => j.triage.verdict === "review")));
  writeFileSync(join(d, "leads.csv"), jobsCsv(seen.filter((j) => j.key.startsWith("lead:"))));
  writeFileSync(join(d, "channels.csv"), toCsv(data.channels as unknown as Record<string, unknown>[]));
  writeFileSync(join(d, "sources.csv"), toCsv(outcomes as unknown as Record<string, unknown>[]));
  writeFileSync(join(d, "link-checks.csv"), toCsv(seen.filter((j) => j.link).map((j) => ({ key: j.key, company: j.company, title: j.title, url: j.url, ...j.link }))));
  writeFileSync(join(d, "outreach.json"), JSON.stringify(outreach, null, 2));
  writeFileSync(join(d, "outreach.csv"), toCsv(outreach.map((e) => ({ company: e.company, size_basis: e.sizeBasis, roles: e.roles.map((r) => `${r.title} <${r.url}>`).join(" | "), hiring_posts: e.hiringPosts.map((p) => p.url).join(" "), public_contacts: e.publicContacts.map((c) => `${c.value} (${c.source})`).join(" "), confidence: e.confidence, note: e.confidenceNote, status: e.status }))));
  // Everything seen this run, rejects included, stays in the (uncommitted) run dir.
  writeFileSync(join(latest.runDir, "all-jobs.csv"), jobsCsv(sorted));
  return d;
}

