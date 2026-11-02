// Folds a run's sightings into the catalog. Pure: the catalog in, the catalog out.
// Jobs merge only on JobKey (ATS id or official link). A posting keeps every
// source that ever reported it, with the first and last time each one did.
import type { Job, JobKey, Sighting, SourceRecord } from "../domain/job.ts";
import { applyExclusions } from "./exclude.ts";
import { applyModelVerdict, type ModelVerdict } from "./modeltriage.ts";
import { triage, type CandidateFacts } from "./triage.ts";

const sourceId = (s: { channel: string; source: string }) => `${s.channel}|${s.source}`;

// The sighting whose fields describe the job: official over third-party, then
// the one with the most description.
function representative(ss: Sighting[]): Sighting {
  return [...ss].sort((a, b) => Number(b.official) - Number(a.official) || b.description.length - a.description.length)[0]!;
}

const DAY = 86_400_000;
// The employer's publication date. A relative "Posted N Days Ago" is resolved
// per fetch and drifts by a day between runs, so a date already recorded within
// a day of the new one is kept.
function publishedOf(rep: Sighting, old: Job | undefined): string {
  if (!rep.official) return old?.publishedAt ?? "";
  if (rep.dateKind === "published") return rep.date;
  if (rep.dateKind !== "relative_posted") return old?.publishedAt ?? "";
  if (old?.publishedAt && Math.abs(Date.parse(old.publishedAt) - Date.parse(rep.date)) <= DAY) return old.publishedAt;
  return rep.date;
}

// ── Alert-only postings ────────────────────────────────────────────────────
// An alert email gives company, title and location, never the employer's page.
// It resolves to an official posting only when exactly one posting already
// fetched from an official source has the same company, the same normalized
// title and a compatible location. The result is a pointer (Job.officialLink);
// the two jobs keep their own keys. Company plus title never merges identities.

const ALERT_CHANNELS = new Set(["gmail_linkedin", "gmail_glassdoor", "gmail_indeed", "gmail_handshake"]);
const COMPANY_SUFFIX = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|plc|lp|llp|gmbh)\b/g;

export const normCompany = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(COMPANY_SUFFIX, " ").replace(/\s+/g, " ").trim();
export const normTitle = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9+# ]+/g, " ").replace(/\s+/g, " ").trim();

const REMOTE = /\bremote\b/i;

// The alert's city (or "remote") must appear in the official location text; if
// the alert names a state code, the official text must not name only other states.
export function locationsCompatible(alert: string, official: string): boolean {
  const a = alert.trim();
  const o = official.toLowerCase();
  if (!a || !o.trim()) return false;
  if (REMOTE.test(a) && REMOTE.test(o)) return true;
  const [city = "", rest = ""] = a.split(",").map((x) => x.trim());
  const c = city.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!c || REMOTE.test(c)) return false;
  const cityHit = new RegExp(`(^|[^a-z])${c.replace(/ /g, "[ ,.-]+")}([^a-z]|$)`).test(o);
  if (!cityHit) return false;
  const state = /^[A-Za-z]{2}\b/.exec(rest)?.[0]?.toLowerCase();
  const officialStates = [...o.matchAll(/,\s*([a-z]{2})\b/g)].map((m) => m[1]!);
  return !state || officialStates.length === 0 || officialStates.includes(state);
}

export const isAlertOnly = (j: Job) => !j.official && j.sources.length > 0 && j.sources.every((s) => ALERT_CHANNELS.has(s.channel)) && !j.key.startsWith("lead:");

// Pure: returns the catalog with officialLink / hints.needsOfficialPage set on
// every alert-only job, recomputed from scratch each time.
export function linkAlertJobs(jobs: Map<JobKey, Job>): Map<JobKey, Job> {
  const official = new Map<string, Job[]>();
  for (const j of jobs.values()) {
    if (!j.official || j.hints.closed) continue;
    const k = `${normCompany(j.company)}|${normTitle(j.title)}`;
    official.set(k, [...(official.get(k) ?? []), j]);
  }
  const out = new Map(jobs);
  for (const j of jobs.values()) {
    if (!isAlertOnly(j)) continue;
    const hits = (official.get(`${normCompany(j.company)}|${normTitle(j.title)}`) ?? []).filter((o) => locationsCompatible(j.location, o.location));
    const { officialLink: _drop, ...rest } = j;
    const hints = { ...j.hints, needsOfficialPage: hits.length !== 1 };
    out.set(j.key, hits.length === 1 && j.company.trim() && j.title.trim() ? { ...rest, hints: { ...hints, needsOfficialPage: false }, officialLink: { key: hits[0]!.key, url: hits[0]!.url, basis: "company+title+location" } } : { ...rest, hints: { ...hints, needsOfficialPage: true } });
  }
  return out;
}

export function mergeRun(prior: Map<JobKey, Job>, sightings: Sighting[], me: CandidateFacts, exclude: readonly string[] = [], verdicts: ReadonlyMap<string, ModelVerdict> = new Map()): Map<JobKey, Job> {
  const byKey = new Map<JobKey, Sighting[]>();
  for (const s of sightings) byKey.set(s.key, [...(byKey.get(s.key) ?? []), s]);
  const out = new Map(prior);

  for (const [key, ss] of byKey) {
    const old = out.get(key);
    const rep = representative(ss);
    const keepOld = old && old.official && !rep.official;
    const sources = new Map<string, SourceRecord>((old?.sources ?? []).map((r) => [sourceId(r), r]));
    for (const s of ss) {
      const id = sourceId(s);
      const was = sources.get(id);
      sources.set(id, {
        channel: s.channel,
        source: s.source,
        url: s.url,
        official: s.official,
        date: s.date,
        dateKind: s.dateKind,
        firstSeen: was ? (was.firstSeen < s.seenAt ? was.firstSeen : s.seenAt) : s.seenAt,
        lastSeen: was && was.lastSeen > s.seenAt ? was.lastSeen : s.seenAt,
      });
    }
    const all = [...sources.values()].sort((a, b) => a.firstSeen.localeCompare(b.firstSeen));
    const fields = keepOld
      ? { company: old.company, title: old.title, location: old.location, url: old.url, description: old.description, official: true, publishedAt: old.publishedAt }
      : {
          company: rep.company,
          title: rep.title,
          location: rep.location,
          url: rep.url,
          description: rep.description,
          official: rep.official,
          publishedAt: publishedOf(rep, old),
        };
    // Any source saying "closed" only counts while no official source lists it.
    const closed = !fields.official && ss.some((s) => s.hints.closed) && !ss.some((s) => !s.hints.closed);
    const hints: Sighting["hints"] = {
      ...Object.assign({}, ...ss.map((s) => s.hints)),
      closed,
      earlyCareerList: ss.some((s) => s.hints.earlyCareerList) || Boolean(old?.hints.earlyCareerList),
      unresolved: ss.every((s) => s.hints.unresolved) && !fields.official,
    };
    const job: Job = {
      key,
      ...fields,
      sources: all,
      firstSeen: all[0]!.firstSeen,
      lastSeen: all.reduce((m, r) => (r.lastSeen > m ? r.lastSeen : m), ""),
      hints,
      triage: { verdict: "review", rule: "pending", reason: "" },
      size: old?.size ?? "unknown",
      ...(old?.link ? { link: old.link } : {}),
    };
    job.triage = triage(job, me);
    job.triage = applyModelVerdict(job, verdicts.get(key));
    job.triage = applyExclusions(job, exclude);
    out.set(key, job);
  }
  return linkAlertJobs(out);
}

// Re-run triage over the whole catalog, e.g. after a rule change.
export function retriage(jobs: Iterable<Job>, me: CandidateFacts, exclude: readonly string[] = [], verdicts: ReadonlyMap<string, ModelVerdict> = new Map()): Job[] {
  return [...jobs].map((j) => {
    const t = { ...j, triage: triage(j, me) };
    const m = { ...t, triage: applyModelVerdict(t, verdicts.get(j.key)) };
    return { ...m, triage: applyExclusions(m, exclude) };
  });
}

// Jobs no source has reported since `since` are probably closed; they stay in
// the catalog with their history but are not counted as open.
export const isOpen = (j: Job, since: string) => j.lastSeen >= since && !j.hints.closed;
