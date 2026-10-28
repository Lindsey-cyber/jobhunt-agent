import { describe, expect, it } from "vitest";
import { buildPlan } from "../src/plan/plan.ts";
import { field, form, makeUserData } from "./helpers.ts";

const user = makeUserData();
const plan1 = (f: ReturnType<typeof field>, bank = user.bank) => buildPlan(form([f]), user.profile, bank).items[0]!;

describe("buildPlan", () => {
  it("fills identity and contact from the profile", () => {
    const items = buildPlan(form([field("First Name"), field("Email"), field("LinkedIn Profile")]), user.profile, user.bank).items;
    expect(items.map((i) => (i.status === "fill" ? i.value : i.status))).toEqual(["Ada", "ada@example.com", "https://www.linkedin.com/in/example"]);
  });

  it("answers sponsorship from structured data, mapped onto the form's options", () => {
    const item = plan1(field("Will you now or in the future require sponsorship?", { kind: "combobox", options: ["Yes, I will", "No, I won't"] }));
    expect(item).toMatchObject({ status: "fill", value: "Yes, I will", sensitive: true });
  });

  it("does not answer work authorization when the question names no country", () => {
    const item = plan1(field("Are you legally authorized to work in the country where this job is located?", { kind: "select", options: ["Yes", "No"] }));
    expect(item.status).toBe("blocked");
  });

  it("never fuzzy-matches a sensitive question to a different bank entry", () => {
    const bank = { answers: [{ id: "misd", question: "Have you ever been convicted of a misdemeanor?", aliases: [], answer: "No", origin: "human" as const }] };
    const item = plan1(field("Have you ever been convicted of a felony?", { kind: "select", options: ["Yes", "No"] }), bank);
    expect(item.status).toBe("blocked");
  });

  it("answers citizenship from structured data and veteran status onto the form's wording", () => {
    expect(plan1(field("Are you a citizen of the United States?", { kind: "select", options: ["Yes", "No"] }))).toMatchObject({ status: "fill", value: "Yes" });
    const vet = { ...user.profile, eeo: { ...user.profile.eeo, veteran: "no" } };
    const item = buildPlan(form([field("Veteran Status", { kind: "select", options: ["I am a protected veteran", "I am not a protected veteran", "I don't wish to answer"] })]), vet, user.bank).items[0];
    expect(item).toMatchObject({ status: "fill", value: "I am not a protected veteran" });
  });

  it("fuzzy-matches ordinary questions at amber confidence", () => {
    const bank = { answers: [{ id: "hear", question: "How did you hear about this job?", aliases: [], answer: "Careers page", origin: "human" as const }] };
    const item = plan1(field("How did you hear about this job opening?"), bank);
    expect(item).toMatchObject({ status: "fill", value: "Careers page" });
    expect(item.status === "fill" && item.confidence).toBeLessThan(0.9);
  });

  it("refuses compensation even when required", () => {
    expect(plan1(field("What are your salary expectations?"))).toMatchObject({ status: "blocked", reason: expect.stringContaining("compensation") });
    // The candidate's own range goes into expectation questions only, never current pay.
    const p = { ...user.profile, salaryExpectation: "$100K–$150K" };
    const one = (f: ReturnType<typeof field>) => buildPlan(form([f]), p, user.bank).items[0]!;
    expect(one(field("What are your salary expectations? Please state a range."))).toMatchObject({ status: "fill", value: "$100K–$150K" });
    expect(one(field("What is your current salary?"))).toMatchObject({ status: "blocked" });
    expect(one(field("Desired salary", { kind: "select", options: ["$80-100K", "$100-150K"] }))).toMatchObject({ status: "blocked" });
  });

  it("skips an optional unknown question and blocks a required one", () => {
    expect(plan1(field("Favorite robot?", { required: false })).status).toBe("skip");
    expect(plan1(field("Favorite robot?")).status).toBe("blocked");
  });

  it("maps an EEO decline onto the form's wording", () => {
    const item = plan1(field("Gender", { kind: "combobox", required: false, options: ["Male", "Female", "I don't wish to answer"] }));
    expect(item).toMatchObject({ status: "fill", value: "I don't wish to answer" });
  });

  it("substitutes the company into bank answers", () => {
    const bank = { answers: [{ id: "why", question: "Why do you want to work at {company}?", aliases: [], answer: "Because {company} ships.", origin: "human" as const }] };
    expect(plan1(field("Why do you want to work at Acme Robotics?", { kind: "textarea" }), bank)).toMatchObject({ value: "Because Acme Robotics ships.", confidence: 1 });
  });

  it("attaches the resume to a resume upload and nothing else", () => {
    expect(plan1(field("Resume/CV", { kind: "file" }))).toMatchObject({ status: "fill", value: user.profile.documents.resume });
    expect(plan1(field("Cover Letter", { kind: "file", required: false })).status).toBe("skip");
  });

  it("answers 'authorized in the country where the job is located' only when every job location is in one known country", async () => {
    const { buildPlan } = await import("../src/plan/plan.ts");
    const q = field("Are you legally authorized to work in the country where the job is located?", { kind: "select", options: ["Yes", "No"] });
    const u = makeUserData();
    const us = buildPlan({ ...form([q]), jobLocation: "San Francisco, CA; Seattle, WA; New York, NY" }, u.profile, u.bank).items[0]!;
    expect(us).toMatchObject({ status: "fill", source: { type: "profile", path: "workAuthorization.authorizedCountries" } });
    const mixed = buildPlan({ ...form([q]), jobLocation: "New York, NY; London, UK" }, u.profile, u.bank).items[0]!;
    expect(mixed.status).toBe("blocked");
  });

  // From the real Lever capture: an acknowledgement checkbox that mentions LinkedIn.
  it("never fills an acknowledgement checkbox, and puts links only into text fields", () => {
    const u = makeUserData();
    const ack = field("AHEAD will consider the contents of an uploaded resume or LinkedIn profile only insofar as it pertains to employment history", { kind: "checkbox", options: ["I Acknowledge"] });
    const [item] = buildPlan(form([ack]), u.profile, u.bank).items;
    expect(item).toMatchObject({ status: "blocked", reason: "acknowledgements and consents need the candidate" });
    expect(buildPlan(form([field("LinkedIn URL")]), u.profile, u.bank).items[0]).toMatchObject({ status: "fill" });
  });

  // From the real Waymo form: the candidate lets the agent tick privacy-policy boxes, nothing else.
  it("ticks a privacy-policy acknowledgement only when the candidate allowed it, and never an interview-conduct one", () => {
    const u = makeUserData();
    const privacy = field("Please review and acknowledge our Candidate Privacy Policy linked below:", { kind: "checkbox", options: ["I acknowledge that I have read and understood the terms of the Waymo Applicant and Candidate Privacy Policy."] });
    const ai = field("Waymo prohibits the use of artificial intelligence (AI) tools during the interview process. You acknowledge the above policies and our privacy policy.", { kind: "checkbox", options: ["I acknowledge the above policies."] });
    expect(buildPlan(form([privacy]), u.profile, u.bank).items[0]).toMatchObject({ status: "blocked" });
    const allowed = { ...u.profile, acknowledgePrivacyPolicies: true };
    expect(buildPlan(form([privacy]), allowed, u.bank).items[0]).toMatchObject({ status: "fill", value: privacy.options[0] });
    expect(buildPlan(form([ai]), allowed, u.bank).items[0]).toMatchObject({ status: "blocked" });
  });

  it("picks the never-worked-here option from the resume's employers", () => {
    const f = field("Are you a current or former Alphabet employee, intern, vendor, contractor, or temp (including Google and other Alphabet subsidiaries)?", {
      kind: "select",
      options: ["Current Alphabet Employee or Intern", "Former Alphabet Employee or Intern", "Current or Former member of Alphabet extended workforce", "Never worked at Alphabet"],
    });
    expect(plan1(f)).toMatchObject({ status: "fill", value: "Never worked at Alphabet" });
  });

  // From NewsBreak's form: a school list cut at 100 entries and generic degree names.
  it("searches a truncated school list and maps a degree onto its generic option", () => {
    const schools = Array.from({ length: 100 }, (_, i) => `A University ${i}`);
    const school = plan1(field("School", { kind: "combobox", options: schools }));
    expect(school).toMatchObject({ status: "fill", value: user.profile.education[0]!.school });
    const degree = plan1(field("Degree", { kind: "combobox", options: ["Bachelor's Degree", "Master's Degree", "Other"] }));
    expect(degree).toMatchObject({ status: "fill", value: "Master's Degree" });
  });

  // From Together AI's form: sponsorship now versus in the future.
  it("chooses future sponsorship for a candidate authorized in the job's country today", () => {
    const f = field("Will you now or in the future require company sponsorship to retain or extend your work authorization in the country where the job is located?", {
      kind: "combobox",
      options: [
        "Yes, I will require immigration sponsorship now to legally work in the country where the job is located.",
        "Yes, I will require immigration sponsorship in the future to legally work in the country where the job is located.",
        "No, I do not and will not require immigration sponsorship to legally work in the country where the job is located.",
      ],
    });
    const p = { ...user.profile, workAuthorization: { authorizedCountries: ["United States"], needsSponsorship: true } };
    const us = { ...form([f]), jobLocation: "San Francisco, CA" };
    expect(buildPlan(us, p, user.bank).items[0]).toMatchObject({ status: "fill", value: f.options[1] });
    expect(buildPlan(form([f]), p, user.bank).items[0]!.status).toBe("blocked");
  });

  // From Lyft's form.
  it("answers Lyft's work authorization, worked-here and one-option privacy dropdown", () => {
    const p = { ...user.profile, acknowledgePrivacyPolicies: true, workAuthorization: { authorizedCountries: ["United States"], needsSponsorship: true } };
    const one = (f: ReturnType<typeof field>) => buildPlan(form([f], "Lyft"), p, user.bank).items[0]!;
    const auth = field("Work Authorization", {
      kind: "combobox",
      options: [
        "I am authorized to work for any employer in the country in which this position is based.",
        "I require/will require Lyft's sponsorship to obtain work authorization in the country in which this position is based (e.g. H-1B, TN, etc.)",
        "My status to work in the country in which this position is based is unknown.",
      ],
    });
    expect(one(auth)).toMatchObject({ status: "fill", value: auth.options[1] });
    expect(one(field("Have you been employed by Lyft, or any subsidiary, affiliate, or business unit of Lyft, in the past (whether on a full-time or part-time basis)?", { kind: "combobox", options: ["Yes", "No"] }))).toMatchObject({ status: "fill", value: "No" });
    const dd = (q: string) => buildPlan(form([field(q, { kind: "combobox", options: ["Yes", "No"] })], "DoorDash USA"), p, user.bank).items[0]!;
    expect(dd("Have you worked at DoorDash?")).toMatchObject({ status: "fill", value: "No" });
    expect(dd("Have you worked at a startup?")).toMatchObject({ status: "blocked" });
    expect(one(field("Please review the linked document:", { kind: "combobox", options: ["I acknowledge that I have read and understood the terms of the Lyft Candidate Privacy Notice."] }))).toMatchObject({ status: "fill" });
  });

  it("fills current company and title from the open work-history entry", () => {
    const p = { ...user.profile, workHistory: [{ employer: "Old Co", title: "Intern", start: "2024-01", end: "2024-06" }, { employer: "Now Co", title: "Engineer", start: "2026-05" }] };
    const items = buildPlan(form([field("Current Company"), field("Current Title")]), p, user.bank).items;
    expect(items.map((i) => (i.status === "fill" ? i.value : i.status))).toEqual(["Now Co", "Engineer"]);
  });

  it("uses a drafted answer only on the posting it was written for", () => {
    const why = { id: "draft:1", question: "Why are you interested in this role?", aliases: [], answer: "Because of the robots.", company: "Acme Robotics", jobTitle: "Intern", origin: "generated" as const };
    const f = field("Why are you interested in this role?");
    expect(buildPlan(form([f]), user.profile, { answers: [why] }).items[0]).toMatchObject({ status: "fill", value: "Because of the robots." });
    expect(buildPlan({ ...form([f]), jobTitle: "Staff Engineer" }, user.profile, { answers: [why] }).items[0]).toMatchObject({ status: "blocked" });
  });
});
