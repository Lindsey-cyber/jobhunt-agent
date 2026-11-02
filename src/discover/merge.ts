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

// The fifty states and DC, code and name. Both spellings of a state compare equal.
export const US_STATES: readonly [string, string][] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["FL", "Florida"], ["GA", "Georgia"],
  ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"],
  ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"],
  ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"],
  ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"],
  ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"],
  ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"],
  ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"],
  ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
  ["DC", "District of Columbia"],
];
const STATE_CODE_BY_KEY = new Map<string, string>([
  ...US_STATES.map(([code]) => [code.toLowerCase(), code] as const),
  ...US_STATES.map(([code, name]) => [name.toLowerCase(), code] as const),
]);
const US_CODES = new Set(US_STATES.map(([code]) => code));

// Region words that may stand in for "anywhere in the US" on a remote line.
const REMOTE_REGION = new Set(["us", "usa", "u s", "united states", "united states of america", "america", "north america", "canada", "anywhere", "emea", "apac", "worldwide", "global", "uk", "united kingdom", "europe"]);

const plain = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// A remote line names remote and at most a region: "Remote", "Remote - US".
// "Austin, TX (Remote)" names a city and is not remote.
function isRemoteText(text: string): boolean {
  if (!/\bremote\b/i.test(text)) return false;
  const rest = text.replace(/\bremote\b/gi, " ").replace(/\b(in|based)\b/gi, " ");
  return rest.split(/[,\-–—()|/;]+/).map((x) => x.replace(/\./g, "").trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean).every((x) => REMOTE_REGION.has(x));
}

// "city, state, country" → exact city phrase and state key. A state is a US code
// or a US state name, both spellings mapped to the code; anything else is kept as
// written (so "Karnataka" or "Ontario" still have to agree).
function parseLocation(text: string): { city: string; state: string } {
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  const cityRaw = plain(parts[0] ?? "");
  const city = cityRaw === "new york city" ? "new york" : cityRaw;
  const keys = parts.slice(1).map((p) => {
    const k = plain(p.replace(/\./g, ""));
    return STATE_CODE_BY_KEY.get(k) ?? k;
  });
  const state = keys.find((k) => US_CODES.has(k)) ?? keys[0] ?? "";
  return { city, state };
}

// The alert's location must be the official location: a remote line matches only
// remote-only official text; a city matches an official location whose city is
// that exact phrase (so "South San Francisco" never matches "San Francisco") and,
// when the alert names a state, whose state is the same state. Official text that
// names no state does not satisfy an alert that does: when in doubt, no link.
export function locationsCompatible(alert: string, official: string): boolean {
  const a = alert.trim();
  const entries = official.split(/[;|]/).map((x) => x.trim()).filter(Boolean);
  if (!a || entries.length === 0) return false;
  if (isRemoteText(a)) return entries.every(isRemoteText);
  const want = parseLocation(a);
  if (!want.city) return false;
  return entries.some((e) => {
    if (isRemoteText(e)) return false;
    const got = parseLocation(e);
    return got.city === want.city && (!want.state || got.state === want.state);
  });
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
