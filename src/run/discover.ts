// Discovery manager's code worker: fetch every source, follow third-party leads
// to their employers' official boards, merge into the catalog, check links.
// Read-only toward employers: it never opens an application form.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Job, Sighting } from "../domain/job.ts";
import { atsOf } from "../discover/identity.ts";
import { classifyLink } from "../discover/links.ts";
import { mergeRun } from "../discover/merge.ts";
import { alertChannel, parseAlert, type AlertMessage } from "../discover/parse.ts";
import { triage, type CandidateFacts } from "../discover/triage.ts";
import type { Profile } from "../profile/schema.ts";
import { probe, pool } from "../sources/http.ts";
import { fetchBoard, fetchGithub, fetchHn, fetchWorkday, type BoardKind, type Fetched, type SourceOutcome, type Watchlist } from "../sources/fetch.ts";
import { readCatalog, writeCatalog } from "../store/catalog.ts";

export function candidateFacts(p: Profile): CandidateFacts {
  return {
    needsSponsorship: p.workAuthorization.needsSponsorship,
    usCitizen: p.citizenship.some((c) => /^(us|usa|u\.s\.|united states( of america)?)$/i.test(c.trim())),
    hasPhd: p.education.some((e) => /ph\.?d|doctor/i.test(e.degree)),
  };
}

export interface DiscoverOptions {
  dataDir: string;
  watchlist: Watchlist;
  facts: CandidateFacts;
  // Directory of alert emails copied from Gmail (one JSON per message), if any.
  inboxDir?: string;
  expandLimit?: number;
  linkCheckLimit?: number;
  only?: string[];
  log?: (s: string) => void;
}

export interface DiscoverResult {
  runDir: string;
  startedAt: string;
  finishedAt: string;
  outcomes: SourceOutcome[];
  sightings: Sighting[];
  jobs: Job[];
  catalogPath: string;
}

const stamp = (d: string) => d.replace(/[:.]/g, "-");

// Boards reachable from a third-party URL: hosted Greenhouse, Lever and Ashby
// paths name the board in their first segment.
function boardOf(url: string): { kind: BoardKind; board: string } | undefined {
  const u = new URL(url);
  const first = decodeURIComponent(u.pathname.split("/").filter(Boolean)[0] ?? "");
  if (!first || first === "embed") return undefined;
  if (u.hostname.endsWith("greenhouse.io") && /\/jobs\/\d+/.test(u.pathname)) return { kind: "greenhouse", board: first };
  if (u.hostname === "jobs.lever.co") return { kind: "lever", board: first };
  if (u.hostname === "jobs.ashbyhq.com") return { kind: "ashby", board: first };
  return undefined;
}

export function readInbox(dir: string): AlertMessage[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as AlertMessage);
}

export async function discover(opts: DiscoverOptions): Promise<DiscoverResult> {
  const log = opts.log ?? (() => {});
  const startedAt = new Date().toISOString();
  const runDir = join(opts.dataDir, "runs", "discovery", stamp(startedAt));
  mkdirSync(runDir, { recursive: true });
  const w = opts.watchlist;
  const want = (name: string) => !opts.only || opts.only.includes(name);

  const tasks: (() => Promise<Fetched>)[] = [];
  if (want("greenhouse")) for (const b of w.greenhouse) tasks.push(() => fetchBoard("greenhouse", b, startedAt));
  if (want("lever")) for (const b of w.lever) tasks.push(() => fetchBoard("lever", b, startedAt));
  if (want("ashby")) for (const b of w.ashby) tasks.push(() => fetchBoard("ashby", b, startedAt));
  if (want("workday")) for (const s of w.workday) tasks.push(() => fetchWorkday(s, w.workdayQueries, startedAt));
  if (want("github")) for (const g of w.github) tasks.push(() => fetchGithub(g, startedAt));
  if (want("hn")) tasks.push(() => fetchHn(w.hn.commentLimit, startedAt));

  const fetched = await pool(tasks, 6, async (t) => {
    const f = await t();
    log(`${f.outcome.ok ? "ok  " : "FAIL"} ${f.outcome.channel.padEnd(20)} ${String(f.outcome.count).padStart(5)}  ${f.outcome.name}${f.outcome.error ? `  ${f.outcome.error}` : ""}`);
    return f;
  });
  const sightings = fetched.flatMap((f) => f.sightings);
  const outcomes = fetched.map((f) => f.outcome);

  // Gmail alerts arrive as files: the session copies them with the Gmail
  // connector today, the VPS will use the Gmail API read-only.
  if (want("gmail")) {
    const messages = opts.inboxDir ? readInbox(opts.inboxDir) : [];
    const byChannel = new Map<string, number>();
    for (const m of messages) {
      const s = parseAlert(m, startedAt);
      sightings.push(...s);
      for (const x of s) byChannel.set(x.channel, (byChannel.get(x.channel) ?? 0) + 1);
    }
    if (!opts.inboxDir || messages.length === 0) {
      outcomes.push({ name: "Gmail job alerts", channel: "gmail_linkedin", url: "gmail", ok: false, count: 0, error: "skipped: no alert emails imported for this run (Gmail API on the VPS not configured yet)" });
    } else {
      for (const ch of ["gmail_linkedin", "gmail_glassdoor", "gmail_handshake", "gmail_indeed"] as const) {
        const n = messages.filter((m) => alertChannel(m.sender) === ch).length;
        outcomes.push({ name: `Gmail ${ch.slice(6)} alerts`, channel: ch, url: opts.inboxDir, ok: true, count: byChannel.get(ch) ?? 0, note: `${n} alert emails` });
      }
      const empty = messages.filter((m) => parseAlert(m, startedAt).length === 0);
      if (empty.length) outcomes.push({ name: "Gmail emails without job cards", channel: "gmail_linkedin", url: opts.inboxDir, ok: true, count: 0, note: `${empty.length} of ${messages.length} emails had no job listing (newsletters, invitations, application receipts)` });
    }
  }

  // Follow promising third-party leads to the employer's own board, so the
  // official requirements decide triage, not a list's copy.
  const known = new Set([...w.greenhouse.map((b) => `greenhouse:${b.board}`), ...w.lever.map((b) => `lever:${b.board}`), ...w.ashby.map((b) => `ashby:${b.board}`)].map((s) => s.toLowerCase()));
  const leads = new Map<string, { kind: BoardKind; board: string; company: string; from: string }>();
  for (const s of sightings) {
    if (s.official || !atsOf(s.key)) continue;
    const b = boardOf(s.url);
    if (!b || known.has(`${b.kind}:${b.board}`.toLowerCase())) continue;
    if (triage({ ...s, description: "" }, opts.facts).verdict === "reject") continue;
    const id = `${b.kind}:${b.board}`.toLowerCase();
    if (!leads.has(id)) leads.set(id, { ...b, company: s.company, from: s.source });
  }
  const expansion = [...leads.values()].slice(0, opts.expandLimit ?? 150);
  const expanded = await pool(expansion, 6, async (l) => {
    const f = await fetchBoard(l.kind, l, startedAt);
    f.outcome.discoveredFrom = l.from;
    log(`${f.outcome.ok ? "ok  " : "FAIL"} ${f.outcome.channel.padEnd(20)} ${String(f.outcome.count).padStart(5)}  ${l.company} (from ${l.from})`);
    return f;
  });
  for (const f of expanded) {
    sightings.push(...f.sightings);
    outcomes.push(f.outcome);
  }
  if (leads.size > expansion.length) log(`expansion capped: ${leads.size - expansion.length} boards not fetched`);

  const catalogPath = join(opts.dataDir, "discovery", "catalog.jsonl");
  const merged = mergeRun(readCatalog(catalogPath), sightings, opts.facts);

  // Size band per job from the board that listed it, else from the watchlist by company name.
  const sizeBySource = new Map(outcomes.filter((o) => o.size).map((o) => [o.url, o.size!]));
  const sizeByCompany = new Map(outcomes.filter((o) => o.size && !o.discoveredFrom).map((o) => [o.name.toLowerCase(), o.size!]));
  for (const j of merged.values()) {
    const fromBoard = j.sources.map((s) => sizeBySource.get(s.source)).find(Boolean);
    j.size = fromBoard ?? sizeByCompany.get(j.company.toLowerCase()) ?? j.size;
  }

  // Link check on what the candidate will look at first: matches seen this run.
  const toCheck = [...merged.values()]
    .filter((j) => j.lastSeen >= startedAt && j.triage.verdict === "match" && !j.key.startsWith("lead:"))
    .sort((a, b) => Number(b.official) - Number(a.official))
    .slice(0, opts.linkCheckLimit ?? 400);
  await pool(toCheck, 8, async (j) => {
    const at = new Date().toISOString();
    try {
      j.link = classifyLink(j.url, await probe(j.url), at);
    } catch (e) {
      j.link = { status: "unverified", http: 0, finalUrl: "", checkedAt: at, note: e instanceof Error ? e.message.slice(0, 120) : String(e) };
    }
  });
  log(`link-checked ${toCheck.length} matches`);

  writeCatalog(catalogPath, merged.values());
  const finishedAt = new Date().toISOString();
  const jobs = [...merged.values()];
  writeFileSync(join(runDir, "outcomes.json"), JSON.stringify(outcomes, null, 2));
  writeFileSync(join(runDir, "run.json"), JSON.stringify({ startedAt, finishedAt, sightings: sightings.length, jobs: jobs.length }, null, 2));
  writeFileSync(join(runDir, "sightings.jsonl"), sightings.map((s) => JSON.stringify({ ...s, description: s.description.slice(0, 300) })).join("\n") + "\n");
  return { runDir, startedAt, finishedAt, outcomes, sightings, jobs, catalogPath };
}

