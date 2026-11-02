// One posting is one Job. Every place it was seen is a Sighting, kept forever.
// Sightings merge into a Job only through a JobKey: an ATS job id or an
// official link. Company plus title is never an identity.

export type JobKey = string & { readonly __brand: "JobKey" };

export type Channel =
  | "official_greenhouse"
  | "official_lever"
  | "official_ashby"
  | "official_workday"
  | "official_smartrecruiters"
  | "official_oracle_hcm"
  | "official_amazon"
  | "github_newgrad"
  | "gmail_linkedin"
  | "gmail_glassdoor"
  | "gmail_handshake"
  | "gmail_indeed"
  | "hn_hiring";

export const OFFICIAL_CHANNELS: readonly Channel[] = ["official_greenhouse", "official_lever", "official_ashby", "official_workday", "official_smartrecruiters", "official_oracle_hcm", "official_amazon"];

// What a date on a sighting means. "published" and "relative_posted" (an
// employer's "Posted 3 Days Ago", resolved against fetch time, day precision)
// are the employer's own publication date; the rest must never be reported as
// one. "posted_before" is only an upper bound ("Posted 30+ Days Ago": posted on
// or before that date).
export type DateKind = "published" | "relative_posted" | "posted_before" | "updated" | "start_date" | "list_posted" | "list_age" | "email_received" | "post_time" | "none";

export interface Sighting {
  key: JobKey;
  channel: Channel;
  // The board, list, email or post the job was seen in.
  source: string;
  // The job URL exactly as that source gave it (tracking stripped).
  url: string;
  seenAt: string;
  official: boolean;
  company: string;
  title: string;
  location: string;
  description: string;
  date: string;
  dateKind: DateKind;
  hints: {
    closed?: boolean;
    // A third party's statement about sponsorship, e.g. Simplify's field.
    sponsorship?: string;
    // The source only lists early-career roles.
    earlyCareerList?: boolean;
    // The source does not identify one posting (a hiring post, an alert without a link).
    unresolved?: boolean;
    // Set on a job only ever seen in an alert email (title, company, location)
    // that matched no official posting uniquely: it still needs its official page.
    needsOfficialPage?: boolean;
    // Public contact text in a hiring post.
    contact?: string;
  };
}

export type Verdict = "match" | "review" | "reject";

export interface Triage {
  verdict: Verdict;
  // Stable rule id, e.g. "role.out_of_scope", so audits can count by rule.
  rule: string;
  reason: string;
}

export interface SourceRecord {
  channel: Channel;
  source: string;
  url: string;
  official: boolean;
  date: string;
  dateKind: DateKind;
  firstSeen: string;
  lastSeen: string;
}

export interface Job {
  key: JobKey;
  company: string;
  title: string;
  location: string;
  // Official URL when an official source saw it, else the first source's URL.
  url: string;
  official: boolean;
  // Employer publication date from an official source only.
  publishedAt: string;
  description: string;
  sources: SourceRecord[];
  firstSeen: string;
  lastSeen: string;
  triage: Triage;
  hints: Sighting["hints"];
  size: SizeBand;
  link?: LinkCheck;
  // An alert-only job's unique official counterpart (same company, same title,
  // compatible location). A pointer only: the two stay separate jobs.
  officialLink?: OfficialLink;
}

export interface OfficialLink {
  key: JobKey;
  url: string;
  basis: "company+title+location";
}

// A code check that the posting's page is live, never an agent's opinion.
export interface LinkCheck {
  status: "valid" | "invalid" | "blocked" | "unverified";
  http: number;
  finalUrl: string;
  checkedAt: string;
  note: string;
}

export type SizeBand = "medium_large" | "small_proxy" | "unknown";
