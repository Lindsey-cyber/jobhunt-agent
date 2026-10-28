// Pure parsers: one source's raw response in, Sightings out. No network here;
// src/sources fetches and hands the bodies over.
import type { Channel, DateKind, Sighting } from "../domain/job.ts";
import { canonicalUrl, jobKey, unwrap } from "./identity.ts";
import { decodeEntities, hrefs, htmlToText } from "./text.ts";

type Base = Omit<Sighting, "key" | "hints"> & { hints?: Sighting["hints"] };

function sighting(b: Base): Sighting {
  const url = canonicalUrl(b.url);
  return { ...b, url, key: jobKey(url), hints: b.hints ?? {} };
}

const iso = (v: unknown) => {
  const d = typeof v === "number" ? new Date(v) : new Date(typeof v === "string" ? v : "");
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
};

// ── Official boards ────────────────────────────────────────────────────────

interface GreenhouseJob { id: number; title: string; absolute_url: string; location?: { name?: string }; first_published?: string; updated_at?: string; content?: string; company_name?: string }

export function parseGreenhouse(body: { jobs?: GreenhouseJob[] }, board: string, company: string, seenAt: string): Sighting[] {
  return (body.jobs ?? []).map((j) => {
    const published = iso(j.first_published);
    return sighting({
      channel: "official_greenhouse",
      source: `https://job-boards.greenhouse.io/${board}`,
      // The hosted URL; absolute_url may be the employer's own domain with gh_jid,
      // which keys to the same id.
      url: `https://job-boards.greenhouse.io/${board}/jobs/${j.id}`,
      seenAt,
      official: true,
      company: j.company_name || company,
      title: j.title.trim(),
      location: j.location?.name ?? "",
      description: htmlToText(j.content ?? ""),
      date: published || iso(j.updated_at),
      dateKind: published ? "published" : "updated",
    });
  });
}

interface LeverJob { id: string; text: string; hostedUrl: string; createdAt?: number; categories?: { location?: string; allLocations?: string[]; commitment?: string }; descriptionPlain?: string; lists?: { text: string; content: string }[]; additionalPlain?: string; country?: string; workplaceType?: string }

export function parseLever(body: LeverJob[], board: string, company: string, seenAt: string): Sighting[] {
  return body.map((j) =>
    sighting({
      channel: "official_lever",
      source: `https://jobs.lever.co/${board}`,
      url: j.hostedUrl,
      seenAt,
      official: true,
      company,
      title: j.text.trim(),
      location: [j.categories?.allLocations?.join("; ") || j.categories?.location || "", j.country ? `(${j.country})` : ""].filter(Boolean).join(" "),
      description: [j.descriptionPlain ?? "", ...(j.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`), j.additionalPlain ?? ""].join("\n"),
      // Lever's createdAt is when the posting was created in the ATS; the closest
      // thing Lever publishes to a publication date.
      date: iso(j.createdAt),
      dateKind: "published",
    }),
  );
}

interface AshbyJob { id: string; title: string; jobUrl: string; location?: string; secondaryLocations?: { location?: string }[]; publishedAt?: string; isListed?: boolean; descriptionPlain?: string; employmentType?: string; address?: { postalAddress?: { addressCountry?: string } } }

export function parseAshby(body: { jobs?: AshbyJob[] }, board: string, company: string, seenAt: string): Sighting[] {
  return (body.jobs ?? [])
    .filter((j) => j.isListed !== false)
    .map((j) =>
      sighting({
        channel: "official_ashby",
        source: `https://jobs.ashbyhq.com/${board}`,
        url: j.jobUrl,
        seenAt,
        official: true,
        company,
        title: j.title.trim(),
        location: [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location), j.address?.postalAddress?.addressCountry].filter(Boolean).join("; "),
        description: (j.employmentType ? `Employment type: ${j.employmentType}\n` : "") + (j.descriptionPlain ?? ""),
        date: iso(j.publishedAt),
        dateKind: "published",
      }),
    );
}

export interface WorkdayDetail { jobPostingInfo?: { title?: string; jobDescription?: string; location?: string; additionalLocations?: string[]; startDate?: string; externalUrl?: string; country?: { descriptor?: string }; timeType?: string } }

// site is e.g. https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite
export function parseWorkdayDetail(detail: WorkdayDetail, site: string, externalPath: string, company: string, seenAt: string): Sighting | undefined {
  const j = detail.jobPostingInfo;
  if (!j?.title) return undefined;
  return sighting({
    channel: "official_workday",
    source: site,
    url: j.externalUrl || site + externalPath,
    seenAt,
    official: true,
    company,
    title: j.title.trim(),
    location: [j.location, ...(j.additionalLocations ?? []), j.country?.descriptor].filter(Boolean).join("; "),
    description: (j.timeType ? `Time type: ${j.timeType}\n` : "") + htmlToText(j.jobDescription ?? ""),
    // Workday exposes the posting's start date, not a publication timestamp.
    date: iso(j.startDate),
    dateKind: "start_date",
  });
}

// ── New-grad GitHub lists ──────────────────────────────────────────────────

interface SimplifyListing { company_name: string; title: string; url: string; locations?: string[]; date_posted?: number; active?: boolean; is_visible?: boolean; sponsorship?: string; category?: string }

export function parseSimplifyListings(body: SimplifyListing[], source: string, seenAt: string): Sighting[] {
  return body
    .filter((l) => l.is_visible !== false && /^https?:/.test(l.url ?? ""))
    .flatMap((l) => {
      let url: string;
      try {
        url = canonicalUrl(l.url).replace(/\/application$/, "");
      } catch {
        return [];
      }
      return [
        sighting({
          channel: "github_newgrad",
          source,
          url,
          seenAt,
          official: false,
          company: l.company_name.trim(),
          title: l.title.trim(),
          location: (l.locations ?? []).join("; "),
          description: l.category ? `List category: ${l.category}` : "",
          date: l.date_posted ? iso(l.date_posted * 1000) : "",
          dateKind: l.date_posted ? "list_posted" : "none",
          hints: { earlyCareerList: true, closed: l.active === false, ...(l.sponsorship && l.sponsorship !== "Other" ? { sponsorship: l.sponsorship } : {}) },
        }),
      ];
    });
}

const LIST_NOISE = /(^|\.)(imgur\.com|simplify\.jobs|github\.com|shields\.io)$/;

// Markdown tables (| Company | Role | Location | ... | Apply | Age |) where a
// "↳" company cell repeats the row above.
export function parseMarkdownJobTable(md: string, source: string, seenAt: string): Sighting[] {
  const out: Sighting[] = [];
  let header: string[] = [];
  let company = "";
  for (const line of md.split("\n")) {
    if (!line.trim().startsWith("|")) {
      header = [];
      continue;
    }
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    const names = cells.map((c) => htmlToText(c).toLowerCase());
    if (names.includes("company") && (names.includes("role") || names.includes("position"))) {
      header = names;
      continue;
    }
    if (header.length === 0 || cells.length < 4) continue;
    const col = (...n: string[]) => cells[header.findIndex((h) => n.includes(h))] ?? "";
    const cell = (c: string) => htmlToText(c.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")).replace(/\*\*/g, "").replace(/🔥/g, "").trim();
    const name = cell(col("company"));
    if (name && !/^[↳↪]$/.test(name)) company = name;
    const title = cell(col("role", "position"));
    const links = hrefs(col("apply", "posting", "application", "link")).filter((u) => !LIST_NOISE.test(new URL(u).hostname));
    if (!company || !title || links.length === 0) continue;
    const age = cell(col("age", "posted", "date"));
    out.push(
      sighting({
        channel: "github_newgrad",
        source,
        url: links[0]!,
        seenAt,
        official: false,
        company,
        title,
        location: cell(col("location")),
        description: "",
        date: age,
        dateKind: age ? "list_age" : "none",
        hints: { earlyCareerList: true, closed: line.includes("🔒") },
      }),
    );
  }
  return out;
}

// ── Gmail job alerts ───────────────────────────────────────────────────────

// body is the plain-text alternative; html is set when the Gmail API saved the
// message (the session connector gave text only).
export interface AlertMessage { id: string; date: string; sender: string; subject: string; viewUrl?: string; body: string; html?: string }

export function alertChannel(sender: string): Channel | undefined {
  const s = sender.toLowerCase();
  if (s.includes("linkedin.com")) return "gmail_linkedin";
  if (s.includes("glassdoor.com")) return "gmail_glassdoor";
  if (s.includes("joinhandshake.com")) return "gmail_handshake";
  if (s.includes("indeed.com")) return "gmail_indeed";
  return undefined;
}

const LINKEDIN_NOISE = /^your job alert|new jobs? match|^\d+\+? new jobs|school alum|actively (hiring|recruiting)|apply with resume|easy apply|connections? work|early applicant|^promoted$|top applicant|response insights|fast growing|^\d+ applicants?/i;

export function parseAlert(m: AlertMessage, seenAt: string): Sighting[] {
  const channel = alertChannel(m.sender);
  if (!channel) return [];
  const source = m.viewUrl || `gmail:${m.id}`;
  const base = { channel, source, seenAt, official: false, description: "", date: iso(m.date), dateKind: "email_received" as DateKind };
  const lines = m.body.split("\n").map((l) => decodeEntities(l).replace(/[​-‍﻿͏ ]/g, " ").trim());
  const out: Sighting[] = [];

  if (channel === "gmail_linkedin") {
    // Cards separated by dashed rules: title / company / location, then badges
    // ("1 school alum", "Actively hiring"...), then "View job: <url>".
    let card: string[] = [];
    for (const l of lines) {
      if (/^-{5,}$/.test(l)) {
        card = [];
        continue;
      }
      const view = /^View job:\s*(\S+)/.exec(l);
      if (view) {
        const [title, company, location] = card.filter((x) => x && !LINKEDIN_NOISE.test(x));
        if (title && company) out.push(sighting({ ...base, url: unwrap(view[1]!), company, title, location: location ?? "" }));
        card = [];
      } else card.push(l);
    }
  } else if (channel === "gmail_glassdoor") {
    // [| || | Company 4.1 ★ || Title || Location || salary | age |](url)
    for (const g of m.body.matchAll(/\[\|([^\]]*)\|\]\((\S+?)\)/g)) {
      const cells = g[1]!.split("||").map((c) => c.replace(/\|/g, " ").trim()).filter(Boolean);
      const url = unwrap(g[2]!);
      if (cells.length < 3 || !/jobListingId=\d+/.test(url)) continue;
      const company = cells[0]!.replace(/\s+\d(\.\d)?\s*★\s*$/, "").trim();
      const location = cells[2]!.replace(/\s{2,}(\d+[dh]|30d\+|just posted)$/i, "").trim();
      out.push(sighting({ ...base, url, company, title: cells[1]!, location }));
    }
  } else if (channel === "gmail_handshake") {
    // Company / Title / blank / "pay • type • location". No job link in the text.
    lines.forEach((l, i) => {
      if (!/•/.test(l) || !lines[i - 2] || !lines[i - 3] || lines[i - 1] !== "") return;
      const parts = l.split("•").map((x) => x.trim());
      out.push({
        key: `lead:handshake:${m.id}:${out.length}` as Sighting["key"],
        ...base,
        url: source,
        company: lines[i - 3]!,
        title: lines[i - 2]!,
        location: parts.at(-1) ?? "",
        description: l,
        hints: { unresolved: true },
      });
    });
  } else {
    for (const u of hrefs(m.body)) {
      if (/[?&]jk=/.test(u)) out.push(sighting({ ...base, url: unwrap(u), company: "", title: "", location: "", hints: { unresolved: true } }));
    }
  }
  return out;
}

// ── Hacker News "Who is hiring" ────────────────────────────────────────────

export interface HnComment { id: number; by?: string; time?: number; text?: string; deleted?: boolean; dead?: boolean }

const ATS_HOST = /(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|smartrecruiters\.com)$/;

export function parseHnComment(c: HnComment, thread: number, seenAt: string): Sighting[] {
  if (!c.text || c.deleted || c.dead) return [];
  const text = htmlToText(c.text.replace(/<p>/g, "\n"));
  const firstLine = text.split("\n")[0] ?? "";
  const company = firstLine.split("|")[0]!.trim().slice(0, 80);
  const post = `https://news.ycombinator.com/item?id=${c.id}`;
  const emails = [...new Set(text.match(/[\w.+-]+@[\w-]+\.[\w.-]*[a-z]{2,}/gi) ?? [])];
  const base = {
    channel: "hn_hiring" as Channel,
    source: `https://news.ycombinator.com/item?id=${thread}`,
    seenAt,
    official: false,
    company,
    title: firstLine.slice(0, 200),
    location: firstLine.split("|").slice(1).join("|").trim().slice(0, 160),
    description: text,
    date: c.time ? iso(c.time * 1000) : "",
    dateKind: "post_time" as DateKind,
    hints: { unresolved: true, ...(emails.length ? { contact: emails.join(", ") } : {}) },
  };
  const ats = hrefs(c.text).filter((u) => ATS_HOST.test(new URL(u).hostname));
  const urls = ats.length ? ats : [post];
  // A link to one ATS posting identifies a job; a board link or the post itself does not.
  return urls.map((url) => {
    const s = sighting({ ...base, url });
    return s.key.startsWith("url:") ? s : { ...s, hints: { ...s.hints, unresolved: false } };
  });
}

