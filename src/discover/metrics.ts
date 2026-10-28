// Report numbers, computed from the catalog and one run's sightings. Pure.
import { OFFICIAL_CHANNELS, type Channel, type Job, type Sighting } from "../domain/job.ts";

const DAY = 86_400_000;

export function publishedWithin(j: Job, days: number, now: string): boolean {
  if (!j.publishedAt) return false;
  const age = Date.parse(now) - Date.parse(j.publishedAt);
  return age >= -DAY && age <= days * DAY;
}

export interface ChannelMetrics {
  channel: Channel;
  sightings: number;
  postings: number;
  // Postings no other channel reported in this run.
  exclusive: number;
  shared: number;
  // Share of this channel's sightings that repeated a posting it already listed.
  duplicateRate: number;
  matches: number;
  exclusiveMatches: number;
  published7d: number;
  published30d: number;
  matchesPublished7d: number;
  matchesPublished30d: number;
  unknownPublished: number;
}

export function channelMetrics(sightings: Sighting[], jobs: Map<string, Job>, now: string): ChannelMetrics[] {
  const channelsByKey = new Map<string, Set<Channel>>();
  for (const s of sightings) channelsByKey.set(s.key, (channelsByKey.get(s.key) ?? new Set()).add(s.channel));
  const channels = [...new Set(sightings.map((s) => s.channel))].sort();
  return channels.map((channel) => {
    const mine = sightings.filter((s) => s.channel === channel);
    const keys = [...new Set(mine.map((s) => s.key))];
    const js = keys.map((k) => jobs.get(k)).filter((j): j is Job => Boolean(j));
    const exclusive = keys.filter((k) => channelsByKey.get(k)!.size === 1);
    const matches = js.filter((j) => j.triage.verdict === "match");
    return {
      channel,
      sightings: mine.length,
      postings: keys.length,
      exclusive: exclusive.length,
      shared: keys.length - exclusive.length,
      duplicateRate: mine.length ? 1 - keys.length / mine.length : 0,
      matches: matches.length,
      exclusiveMatches: matches.filter((j) => channelsByKey.get(j.key)!.size === 1).length,
      published7d: js.filter((j) => publishedWithin(j, 7, now)).length,
      published30d: js.filter((j) => publishedWithin(j, 30, now)).length,
      matchesPublished7d: matches.filter((j) => publishedWithin(j, 7, now)).length,
      matchesPublished30d: matches.filter((j) => publishedWithin(j, 30, now)).length,
      unknownPublished: js.filter((j) => !j.publishedAt).length,
    };
  });
}

export const isOfficialChannel = (c: Channel) => OFFICIAL_CHANNELS.includes(c);

const CSV_COLUMNS = [
  "key", "verdict", "rule", "reason", "company", "title", "location", "size", "official", "url", "published_at", "first_seen", "last_seen",
  "channels", "source_count", "earliest_source", "earliest_source_at", "source_dates", "link_status", "link_http", "link_checked_at", "link_note",
] as const;

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function jobsCsv(jobs: Job[]): string {
  const rows = jobs.map((j) => {
    const earliest = j.sources[0];
    return [
      j.key, j.triage.verdict, j.triage.rule, j.triage.reason, j.company, j.title, j.location, j.size, j.official, j.url, j.publishedAt, j.firstSeen, j.lastSeen,
      [...new Set(j.sources.map((s) => s.channel))].join(" "),
      j.sources.length,
      earliest ? `${earliest.channel} ${earliest.source}` : "",
      earliest?.firstSeen ?? "",
      j.sources.filter((s) => s.date).map((s) => `${s.channel}:${s.dateKind}=${s.date}`).join(" "),
      j.link?.status ?? "not_checked", j.link?.http ?? "", j.link?.checkedAt ?? "", j.link?.note ?? "",
    ];
  });
  return [CSV_COLUMNS.join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n") + "\n";
}

export function toCsv(rows: Record<string, unknown>[]): string {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}

// Sort order for anything the candidate reads: matches first, official before
// third-party, live links, established employers, newest publication.
export function priority(a: Job, b: Job): number {
  const rank = (j: Job) => [
    j.triage.verdict === "match" ? 0 : j.triage.verdict === "review" ? 1 : 2,
    j.official ? 0 : 1,
    j.link?.status === "valid" ? 0 : j.link ? 2 : 1,
    j.size === "medium_large" ? 0 : 1,
  ];
  const ra = rank(a), rb = rank(b);
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i]! - rb[i]!;
  return (b.publishedAt || "").localeCompare(a.publishedAt || "");
}
