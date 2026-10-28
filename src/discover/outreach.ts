// Outreach queue for small companies: their openings, public hiring posts and
// any contact the post itself published. Collect and draft only; nothing here
// sends. Pure.
import type { Job } from "../domain/job.ts";
import type { Profile } from "../profile/schema.ts";
import { ROLE, usLocation } from "./triage.ts";

const isHnItem = (j: Job) => j.key.startsWith("url:https://news.ycombinator.com/item");

export interface OutreachEntry {
  company: string;
  sizeBasis: string;
  roles: { title: string; url: string; verdict: string; location: string }[];
  hiringPosts: { url: string; date: string; excerpt: string }[];
  // Only contacts printed in a cited public post. Never guessed, never looked up elsewhere.
  publicContacts: { value: string; source: string }[];
  confidence: "medium" | "low";
  confidenceNote: string;
  draft: string;
  status: "draft_not_sent";
}

function draftFor(p: Profile, company: string, role: string | undefined, now: string): string {
  const ed = [...p.education].sort((a, b) => b.gradYear - a.gradYear || b.gradMonth - a.gradMonth)[0]!;
  const graduated = `${ed.gradYear}-${String(ed.gradMonth).padStart(2, "0")}` <= now.slice(0, 7);
  const month = new Date(Date.UTC(ed.gradYear, ed.gradMonth - 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const name = p.identity.preferredName ? `${p.identity.preferredName} ${p.identity.lastName}` : `${p.identity.firstName} ${p.identity.lastName}`;
  const links = [p.links.linkedin, p.links.github, p.links.website].filter(Boolean).join(" · ");
  return [
    `Hi ${company} team,`,
    "",
    `I came across ${role ? `the ${role} opening` : "your hiring post"} and wanted to reach out directly. I'm ${name}; I ${graduated ? "completed" : "am completing"} a ${ed.degree} in ${ed.major} at ${ed.school} (${month} ${ed.gradYear}) and I'm looking for a new-grad role in machine learning / AI engineering.`,
    "",
    "[Add one project from the resume that fits this team, in your own words. Nothing here may go beyond the resume.]",
    "",
    "Would you be open to a short conversation, or could you point me to the right person for this role?",
    "",
    "Thank you,",
    name,
    links,
  ].join("\n");
}

export function outreachQueue(jobs: Job[], p: Profile, now: string): OutreachEntry[] {
  const byCompany = new Map<string, Job[]>();
  for (const j of jobs) {
    const post = j.sources.some((s) => s.channel === "hn_hiring");
    const small = j.size === "small_proxy";
    if (!post && !small) continue;
    if (j.triage.verdict === "reject" && !(post && ROLE.test(j.description) && j.triage.rule === "role.out_of_scope")) continue;
    if (post && !ROLE.test(`${j.title} ${j.description}`)) continue;
    if (usLocation(j.location) === "non_us") continue;
    const name = j.company.trim() || "(unnamed)";
    byCompany.set(name.toLowerCase(), [...(byCompany.get(name.toLowerCase()) ?? []), j]);
  }
  return [...byCompany.values()].map((js) => {
    const company = js[0]!.company.trim();
    const posts = js.filter((j) => j.sources.some((s) => s.channel === "hn_hiring"));
    const roles = js.filter((j) => !isHnItem(j));
    const contacts = posts.flatMap((j) => (j.hints.contact ? j.hints.contact.split(", ").map((value) => ({ value, source: j.sources.find((s) => s.channel === "hn_hiring")!.url })) : []));
    const unique = [...new Map(contacts.map((c) => [c.value.toLowerCase(), c])).values()];
    const firstRole = roles.find((r) => r.triage.verdict === "match") ?? roles[0];
    return {
      company,
      sizeBasis: js.some((j) => j.size === "small_proxy") ? "≤30 open postings on its official board (proxy, not headcount)" : "posts in HN Who is hiring (size not established)",
      roles: roles.map((r) => ({ title: r.title, url: r.url, verdict: r.triage.verdict, location: r.location })),
      hiringPosts: posts.map((j) => {
        const s = j.sources.find((x) => x.channel === "hn_hiring")!;
        return { url: s.url.startsWith("https://news.ycombinator.com") ? s.url : `${s.url} (linked from HN post)`, date: s.date, excerpt: j.description.slice(0, 280) };
      }),
      publicContacts: unique,
      confidence: unique.length ? "medium" : "low",
      confidenceNote: unique.length
        ? "Address printed in a public HN hiring post; that the poster speaks for the company is not verified."
        : "No published contact; apply through the posting or find a named recruiter by hand.",
      draft: draftFor(p, company, firstRole?.title, now),
      status: "draft_not_sent" as const,
    };
  });
}
