// Folds a run's sightings into the catalog. Pure: the catalog in, the catalog out.
// Jobs merge only on JobKey (ATS id or official link). A posting keeps every
// source that ever reported it, with the first and last time each one did.
import type { Job, JobKey, Sighting, SourceRecord } from "../domain/job.ts";
import { triage, type CandidateFacts } from "./triage.ts";

const sourceId = (s: { channel: string; source: string }) => `${s.channel}|${s.source}`;

// The sighting whose fields describe the job: official over third-party, then
// the one with the most description.
function representative(ss: Sighting[]): Sighting {
  return [...ss].sort((a, b) => Number(b.official) - Number(a.official) || b.description.length - a.description.length)[0]!;
}

export function mergeRun(prior: Map<JobKey, Job>, sightings: Sighting[], me: CandidateFacts): Map<JobKey, Job> {
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
          publishedAt: rep.official && rep.dateKind === "published" ? rep.date : old?.publishedAt ?? "",
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
    out.set(key, job);
  }
  return out;
}

// Re-run triage over the whole catalog, e.g. after a rule change.
export function retriage(jobs: Iterable<Job>, me: CandidateFacts): Job[] {
  return [...jobs].map((j) => ({ ...j, triage: triage(j, me) }));
}

// Jobs no source has reported since `since` are probably closed; they stay in
// the catalog with their history but are not counted as open.
export const isOpen = (j: Job, since: string) => j.lastSeen >= since && !j.hints.closed;
