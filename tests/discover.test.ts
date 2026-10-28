import { describe, expect, it } from "vitest";
import type { Job, JobKey } from "../src/domain/job.ts";
import { jobKey } from "../src/discover/identity.ts";
import { classifyLink } from "../src/discover/links.ts";
import { mergeRun } from "../src/discover/merge.ts";
import { parseAlert, parseGreenhouse, parseMarkdownJobTable, parseSimplifyListings } from "../src/discover/parse.ts";
import { triage, usLocation, type CandidateFacts } from "../src/discover/triage.ts";

const me: CandidateFacts = { needsSponsorship: true, usCitizen: false, hasPhd: false };
const T0 = "2026-10-28T00:00:00.000Z";
const T1 = "2026-10-29T00:00:00.000Z";

describe("job identity", () => {
  it("keys a Greenhouse job by its id wherever the link lives", () => {
    expect(jobKey("https://job-boards.greenhouse.io/stripe/jobs/8243617?gh_src=x")).toBe("greenhouse:8243617");
    expect(jobKey("https://stripe.com/jobs/search?gh_jid=8243617")).toBe("greenhouse:8243617");
    expect(jobKey("https://app.careerpuck.com/job-board/lyft/job/8689127002?gh_jid=8689127002")).toBe("greenhouse:8689127002");
  });

  it("keys Lever and Ashby by their UUID and Workday by tenant and requisition", () => {
    expect(jobKey("https://jobs.lever.co/palantir/67110929-ADEA-41c3-851a-8882e222d9e4/apply")).toBe("lever:67110929-adea-41c3-851a-8882e222d9e4");
    expect(jobKey("https://jobs.ashbyhq.com/quora/40659fe7-545e-4b08-b6d7-2567b18b9ed3/application")).toBe("ashby:40659fe7-545e-4b08-b6d7-2567b18b9ed3");
    expect(jobKey("https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Machine-Learning-Engineer--AI-Safety_JR2021784-1")).toBe(
      "workday:nvidia:jr2021784-1",
    );
  });

  it("unwraps URL Defense and keys alert links by the platform's job id", () => {
    expect(jobKey("https://urldefense.com/v3/__https://www.linkedin.com/comm/jobs/view/4483753691/")).toBe("linkedin:4483753691");
    expect(jobKey("https://urldefense.com/v3/__https://www.glassdoor.com/partner/jobListing.htm?jobListingId=1010306718545")).toBe("glassdoor:1010306718545");
  });

  it("never merges two different URLs on an unknown site, whatever the title", () => {
    expect(jobKey("https://careers.example.com/jobs/1")).not.toBe(jobKey("https://careers.example.com/jobs/2"));
    expect(jobKey("https://careers.example.com/jobs/1?utm_source=list")).toBe(jobKey("https://careers.example.com/jobs/1/"));
  });
});

describe("parsers", () => {
  it("reads a Greenhouse board with its official publication date", () => {
    const [s] = parseGreenhouse(
      { jobs: [{ id: 42, title: " ML Engineer, New Grad ", absolute_url: "https://acme.com/careers?gh_jid=42", location: { name: "New York, NY" }, first_published: "2026-10-01T10:00:00-04:00", content: "&lt;p&gt;Build &amp;amp; ship&lt;/p&gt;" }] },
      "acme",
      "Acme",
      T0,
    );
    expect(s).toMatchObject({ key: "greenhouse:42", title: "ML Engineer, New Grad", official: true, dateKind: "published", date: "2026-10-01T14:00:00.000Z", description: "Build & ship" });
  });

  it("reads Simplify's listing JSON, dropping its /application suffix and keeping its sponsorship note", () => {
    const [s] = parseSimplifyListings(
      [{ company_name: "Xterra AI", title: "Research Engineer", url: "https://jobs.ashbyhq.com/xterra%20ai/468e9870-0d18-468c-8fad-241b1a7566c0/application?embed=true", locations: ["SF"], date_posted: 1784505600, active: true, is_visible: true, sponsorship: "Does Not Offer Sponsorship" }],
      "https://github.com/SimplifyJobs/New-Grad-Positions",
      T0,
    );
    expect(s).toMatchObject({ key: "ashby:468e9870-0d18-468c-8fad-241b1a7566c0", official: false, dateKind: "list_posted", hints: { earlyCareerList: true, closed: false, sponsorship: "Does Not Offer Sponsorship" } });
  });

  it("reads markdown tables, carrying the company down ↳ rows and skipping image links", () => {
    const md = [
      "| Company | Position | Location | Salary | Posting | Age |",
      "|---|---|---|---|---|---|",
      '| <a href="https://www.lyft.com"><strong>Lyft</strong></a> | ML Engineer | San Francisco, CA | $1 | <a href="https://app.careerpuck.com/job-board/lyft/job/8908005002?gh_jid=8908005002"><img src="https://i.imgur.com/x.png" alt="Apply"/></a> | 5d |',
      '| ↳ | Data Engineer | Seattle, WA | $1 | <a href="https://jobs.lever.co/lyft/11111111-2222-3333-4444-555555555555"><img src="https://i.imgur.com/x.png"/></a> | 6d |',
    ].join("\n");
    const rows = parseMarkdownJobTable(md, "list", T0);
    expect(rows.map((r) => [r.company, r.title, r.key, r.date])).toEqual([
      ["Lyft", "ML Engineer", "greenhouse:8908005002", "5d"],
      ["Lyft", "Data Engineer", "lever:11111111-2222-3333-4444-555555555555", "6d"],
    ]);
  });

  it("reads a LinkedIn alert digest block by block", () => {
    const body = [
      "Your job alert for Research engineer",
      "",
      "Machine Learning Engineer",
      "Kargo",
      "New York, NY",
      "",
      "1 school alum",
      "View job: https://urldefense.com/v3/__https://www.linkedin.com/comm/jobs/view/4483753691/",
      "",
      "---------------------------------------------------------",
      "",
      "Member of Technical Staff, Machine Learning",
      "Antioch",
      "New York, NY",
      "View job: https://urldefense.com/v3/__https://www.linkedin.com/comm/jobs/view/4483737982/",
    ].join("\n");
    const rows = parseAlert({ id: "m1", date: "2026-10-28T02:24:00Z", sender: "jobalerts-noreply@linkedin.com", subject: "", body }, T0);
    expect(rows.map((r) => [r.key, r.title, r.company, r.location])).toEqual([
      ["linkedin:4483753691", "Machine Learning Engineer", "Kargo", "New York, NY"],
      ["linkedin:4483737982", "Member of Technical Staff, Machine Learning", "Antioch", "New York, NY"],
    ]);
    expect(rows[0]).toMatchObject({ channel: "gmail_linkedin", dateKind: "email_received", official: false });
  });

  it("reads Glassdoor alert cards and keeps Handshake rows as unresolved leads", () => {
    const gd = "[| || || | | | | Wells Fargo 3.5 ★ || || ML Engineer – Early Careers || || Iselin, NJ || || $48 (Employer est.) | 1d |](https://urldefense.com/v3/__https://www.glassdoor.com/partner/jobListing.htm?jobListingId=1010306718545)";
    expect(parseAlert({ id: "g", date: T0, sender: "noreply@glassdoor.com", subject: "", body: gd }, T0).map((r) => [r.key, r.company, r.title, r.location])).toEqual([
      ["glassdoor:1010306718545", "Wells Fargo", "ML Engineer – Early Careers", "Iselin, NJ"],
    ]);
    const aged = "[| || | ProviderTrust || AI Engineer || Nashville, TN | 1d |](https://www.glassdoor.com/partner/jobListing.htm?jobListingId=7)";
    expect(parseAlert({ id: "g2", date: T0, sender: "noreply@glassdoor.com", subject: "", body: aged }, T0)[0]?.location).toBe("Nashville, TN");
    const hs = "New jobs just for you.\n\nAnthropic\nApplied AI, Research Engineer\n\n$300–400K/yr • Full-Time • Lancaster, CA (Hybrid)\n";
    const [lead] = parseAlert({ id: "h", date: T0, sender: "handshake@g.joinhandshake.com", subject: "", body: hs }, T0);
    expect(lead).toMatchObject({ key: "lead:handshake:h:0", company: "Anthropic", title: "Applied AI, Research Engineer", location: "Lancaster, CA (Hybrid)", hints: { unresolved: true } });
  });
});

const job = (title: string, over: Partial<{ location: string; description: string; official: boolean; hints: object }> = {}) => ({
  title,
  location: "New York, NY",
  description: "",
  official: true,
  hints: {},
  ...over,
});

describe("triage", () => {
  it.each([
    ["Machine Learning Engineer, New Grad", "match"],
    ["AI Software Engineer (2027 New College Graduate)", "match"],
    ["Senior Machine Learning Engineer", "reject"],
    ["Machine Learning Engineer Intern", "reject"],
    ["AI Developer Advocate", "reject"],
    ["Account Executive", "reject"],
    ["Research Scientist, PhD Graduate", "reject"],
    ["ML Research Scientist (MS/PhD), New Grad", "match"],
    ["Machine Learning Engineer", "review"],
    ["Data Scientist, New Grad", "review"],
  ])("%s → %s", (title, verdict) => {
    expect(triage(job(title), me).verdict).toBe(verdict);
  });

  it("excludes only on an explicit no-sponsorship statement, and silence passes", () => {
    expect(triage(job("ML Engineer, New Grad", { description: "We are unable to sponsor visas for this role." }), me).rule).toBe("auth.no_sponsorship");
    expect(triage(job("ML Engineer, New Grad", { description: "Visa sponsorship is available." }), me).verdict).toBe("match");
    expect(triage(job("ML Engineer, New Grad", { description: "Open to candidates with or without sponsorship needs." }), me).verdict).toBe("match");
    expect(triage(job("ML Engineer, New Grad", { description: "We are unable to sponsor visas." }), { ...me, needsSponsorship: false }).verdict).toBe("match");
  });

  it("only reviews a third party's no-sponsorship claim", () => {
    expect(triage(job("ML Engineer, New Grad", { official: false, description: "No sponsorship." }), me).rule).toBe("auth.no_sponsorship_unverified");
    expect(triage(job("ML Engineer, New Grad", { official: false, hints: { sponsorship: "Does Not Offer Sponsorship" } }), me).verdict).toBe("review");
  });

  it("rejects required years beyond 0-2 but not preferred ones", () => {
    expect(triage(job("Machine Learning Engineer", { description: "Requires 5+ years of experience in ML." }), me).rule).toBe("experience.too_senior");
    expect(triage(job("Machine Learning Engineer", { description: "3+ years of experience preferred. New grads welcome." }), me).verdict).toBe("match");
    expect(triage(job("ML Engineer, New Grad", { description: "Minimum 3 years of experience." }), me).rule).toBe("experience.conflict");
    // A range's floor is the requirement: "0–3 years" is open to new grads.
    expect(triage(job("Machine Learning Engineer", { description: "Entry level. 0–3 years of experience in ML." }), me).verdict).toBe("match");
  });

  it("reads clearance and citizenship as required only when not marked preferred", () => {
    expect(triage(job("ML Engineer, New Grad", { description: "Must be a U.S. Citizen with an active Secret clearance." }), me).rule).toBe("auth.citizenship");
    expect(triage(job("ML Engineer, New Grad", { description: "Preferred experience: Active DOD Secret clearance highly desired." }), me).verdict).toBe("match");
  });

  // Cases from audit round 1 (2026-10-28), where the blind auditor was right.
  it("needs ML evidence before a research title counts", () => {
    expect(triage(job("Research Scientist In Vitro Pharmacology", { description: "Run cell-based assays for drug discovery." }), me).rule).toBe("role.research_unclear");
    expect(triage(job("Materials Research Scientist/Engineer, New Grad", { description: "Develop thin-film materials and characterize them. ".repeat(20) }), me).rule).toBe("role.research_not_ml");
    expect(triage(job("Research Scientist, New Grad", { description: "Train large language models (LLMs) for code." }), me).verdict).toBe("match");
    expect(triage(job("Research Scientist, Monetization - New Grad", { official: false, description: "List category: AI/ML/Data" }), me).verdict).toBe("match");
    expect(triage(job("Research Scientist In Vitro Pharmacology", { description: "Deep Genomics uses artificial intelligence to transform drug discovery, with expertise spanning machine learning and biology. You will run cell assays. ".repeat(6) }), me).rule).toBe("role.research_not_ml");
  });

  it("reads a PhD requirement in the description unless a master's also qualifies", () => {
    expect(triage(job("Research Scientist, Generative AI - New College Grad 2026", { description: "What we need to see: Pursuing PhD in Computer Science or related field." }), me).rule).toBe("degree.phd_required");
    expect(triage(job("ML Research Engineer, New Grad", { description: "A PhD in computer vision, machine learning or equivalent industry experience." }), me).rule).toBe("degree.phd_required");
    expect(triage(job("ML Engineer, New Grad", { description: "A PhD is required, or a Master's degree with research experience." }), me).verdict).toBe("match");
    expect(triage(job("ML Engineer, New Grad", { description: "PhD preferred. Strong ML fundamentals." }), me).verdict).toBe("match");
  });

  it("rejects postings that say they are for experienced engineers", () => {
    expect(triage(job("AI Engineer - Forward Deployed (New Grad)", { description: "This role is intended for experienced engineers who have shipped ML systems." }), me).rule).toBe("experience.too_senior");
  });

  // Cases from audit round 2.
  it("applies years stated for a master's degree, and sends 2-year minimums to review", () => {
    expect(triage(job("Machine Learning Engineer", { description: "Qualifications: PhD, or 3+ years of applied ML experience (Master's). New grads welcome." }), me).rule).toBe("experience.too_senior");
    expect(triage(job("Machine Learning Engineer, Radar", { description: "2+ years of experience developing, evaluating, and deploying machine learning models in production." }), me).rule).toBe("experience.two_years");
    expect(triage(job("ML Engineer, New Grad", { description: "Minimum of 2+ years of work experience in developing ML models." }), me).rule).toBe("experience.two_years");
    expect(triage(job("ML Engineer, New Grad", { description: "2+ years of experience with PyTorch is a plus." }), me).verdict).toBe("match");
  });

  // Cases from audit round 3.
  it("reads clearances in titles and long no-sponsorship sentences", () => {
    expect(triage(job("Artificial Intelligence/Machine Learning (AI/ML) Engineer 1 - Top Secret/SCI w/Poly", { location: "Herndon, VA" }), me).rule).toBe("auth.citizenship");
    expect(triage(job("Entry Level Software Engineer, Recommendations", { description: "Applicants must be currently authorized to work in the United States on a full-time basis, without the need for current or future employer sponsorship for an employment-based visa status." }), me).rule).toBe("auth.no_sponsorship");
  });

  it("keeps a multi-level title that includes junior, and nothing else senior", () => {
    expect(triage(job("Senior Associate, Data Scientist - Applied AI"), me).rule).toBe("level.senior");
    expect(triage(job("Principal Scientist / Associate Director, Agentic AI Research"), me).rule).toBe("level.senior");
    expect(triage(job("[Junior / Senior / Staff] Software Engineer, Inference / Compute Infrastructure", { location: "San Francisco, CA" }), me).verdict).not.toBe("reject");
  });

  it("reads locations conservatively", () => {
    expect(usLocation("San Francisco, CA")).toBe("us");
    expect(usLocation("Remote - US")).toBe("us");
    expect(usLocation("London, United Kingdom")).toBe("non_us");
    expect(usLocation("Singapore, Singapore (SG)")).toBe("non_us");
    expect(usLocation("New York, NY; London")).toBe("us");
    expect(usLocation("Remote")).toBe("unknown");
    expect(usLocation("IN-Pune; India")).toBe("non_us");
    expect(usLocation("US-WA-Bellevue")).toBe("us");
    expect(usLocation("Montana")).toBe("us");
    expect(usLocation("US, CA, Santa Clara")).toBe("us");
    expect(triage(job("ML Engineer, New Grad", { location: "Toronto, Canada" }), me).rule).toBe("location.non_us");
  });
});

describe("merge", () => {
  const sighting = (over: object) => ({
    channel: "github_newgrad" as const,
    source: "list-a",
    url: "https://job-boards.greenhouse.io/acme/jobs/1",
    key: "greenhouse:1" as JobKey,
    seenAt: T0,
    official: false,
    company: "Acme",
    title: "ML Engineer, New Grad",
    location: "New York, NY",
    description: "",
    date: "3d",
    dateKind: "list_age" as const,
    hints: {},
    ...over,
  });

  it("merges by key, prefers the official record and keeps every source", () => {
    const jobs = mergeRun(new Map(), [sighting({}), sighting({ channel: "official_greenhouse", source: "board", official: true, title: "Machine Learning Engineer, New Grad", date: T0, dateKind: "published" })], me);
    const j = jobs.get("greenhouse:1" as JobKey)!;
    expect(j.title).toBe("Machine Learning Engineer, New Grad");
    expect(j.publishedAt).toBe(T0);
    expect(j.sources.map((s) => s.channel).sort()).toEqual(["github_newgrad", "official_greenhouse"]);
  });

  it("never merges two postings with the same company and title", () => {
    const jobs = mergeRun(new Map(), [sighting({}), sighting({ key: "greenhouse:2", url: "https://job-boards.greenhouse.io/acme/jobs/2" })], me);
    expect(jobs.size).toBe(2);
  });

  it("keeps a source's first sighting across runs and adds new sources", () => {
    const first = mergeRun(new Map(), [sighting({})], me);
    const second = mergeRun(first, [sighting({ seenAt: T1 }), sighting({ channel: "gmail_linkedin", source: "mail", seenAt: T1 })], me);
    const j = second.get("greenhouse:1" as JobKey)! as Job;
    expect(j.firstSeen).toBe(T0);
    expect(j.lastSeen).toBe(T1);
    expect(j.sources.find((s) => s.channel === "github_newgrad")).toMatchObject({ firstSeen: T0, lastSeen: T1 });
    expect(j.sources.find((s) => s.channel === "gmail_linkedin")).toMatchObject({ firstSeen: T1 });
  });
});

describe("link check", () => {
  it("treats a Greenhouse bounce to the board as closed and LinkedIn's 999 as blocked", () => {
    const url = "https://job-boards.greenhouse.io/acme/jobs/1";
    expect(classifyLink(url, { status: 200, finalUrl: "https://job-boards.greenhouse.io/acme?error=true", body: "" }, T0).status).toBe("invalid");
    expect(classifyLink(url, { status: 200, finalUrl: url, body: "<h1>ML Engineer</h1>" }, T0).status).toBe("valid");
    expect(classifyLink(url, { status: 200, finalUrl: url, body: "Sorry, this job is no longer available" }, T0).status).toBe("invalid");
    expect(classifyLink("https://www.linkedin.com/jobs/view/1", { status: 999, finalUrl: "", body: "" }, T0).status).toBe("blocked");
  });
});
