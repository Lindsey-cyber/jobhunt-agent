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
    expect(one(field("Have you previously worked as Employee or Intern for GlobalFoundries? If Yes, provide additional information; if No, please continue.", { kind: "radio", options: ["Yes", "No"] }))).toMatchObject({ status: "fill", value: "No" });
    expect(one(field("Please review the linked document:", { kind: "combobox", options: ["I acknowledge that I have read and understood the terms of the Lyft Candidate Privacy Notice."] }))).toMatchObject({ status: "fill" });
  });

  it("fills current company and title from the open work-history entry", () => {
    const p = { ...user.profile, workHistory: [{ employer: "Old Co", title: "Intern", start: "2024-01", end: "2024-06" }, { employer: "Now Co", title: "Engineer", start: "2026-05" }] };
    const items = buildPlan(form([field("Current Company"), field("Current Title")]), p, user.bank).items;
    expect(items.map((i) => (i.status === "fill" ? i.value : i.status))).toEqual(["Now Co", "Engineer"]);
  });

  // From Anduril's and Lyft's forms.
  it("answers export-control, clearance, how-heard and employment-history questions from the profile", () => {
    const p = { ...user.profile, citizenship: ["China"], workHistory: [{ employer: "Now Co", title: "Engineer", start: "2026-05" }, { employer: "Lab", title: "Research Assistant", start: "2026-01", end: "2026-05" }] };
    const one = (f: ReturnType<typeof field>) => buildPlan(form([f], "Anduril Industries"), p, user.bank).items[0]!;
    const sel = (label: string, options: string[]) => one(field(label, { kind: "combobox", options }));
    expect(sel("EXPORT CONTROLS - This position requires access to information subject to U.S. export controls.", ["A United States citizen or national", "A person lawfully admitted for permanent residence", "None of the above"])).toMatchObject({ status: "fill", value: "None of the above" });
    expect(sel("CLEARANCE ELIGIBILITY - This position requires eligibility to obtain and maintain a U.S. security clearance.", ["Yes, I hold an active U.S. security clearance", "Yes, I am eligible for a U.S. security clearance", "No"])).toMatchObject({ status: "fill", value: "No" });
    expect(sel("If you have held a U.S. security clearance in the past, what clearance level have you held?", ["N/A - have never held U.S. security clearance", "Secret"])).toMatchObject({ status: "fill", value: "N/A - have never held U.S. security clearance" });
    expect(sel("How did you hear about Anduril?", ["Google job search", "LinkedIn", "GitHub"])).toMatchObject({ status: "fill", value: "GitHub" });
    const items = buildPlan(form([field("Company name"), field("Title"), field("Start date month", { kind: "combobox", options: ["January", "May"] }), field("End date year")]), p, user.bank).items;
    expect(items.map((i) => (i.status === "fill" ? i.value : i.status))).toEqual(["Lab", "Research Assistant", "January", "2026"]);
  });

  // From Asana's, Lila's, Pinterest's and Block's forms.
  it("answers sanctioned-country, residence, work-authorization-assistance and posted-location questions", () => {
    const p = { ...user.profile, citizenship: ["China"], workAuthorization: { authorizedCountries: ["United States"], needsSponsorship: true } };
    const yn = { kind: "combobox" as const, options: ["Yes", "No"] };
    const one = (label: string) => buildPlan({ ...form([field(label, yn)]), jobLocation: "New York, NY" }, p, user.bank).items[0]!;
    expect(one("Are you a citizen or legal permanent resident of Cuba, Iran, North Korea, Syria or Ukraine (Crimea region)?")).toMatchObject({ status: "fill", value: "No" });
    expect(one("Will you require our assistance with work authorization now or in the future?")).toMatchObject({ status: "fill", value: "Yes" });
    expect(one("Are you authorized to work lawfully in the location posted for this position?")).toMatchObject({ status: "fill", value: "Yes" });
    expect(one("Do you currently reside within the continental United States?")).toMatchObject({ status: "fill" });
  });

  // From ADI's Workday form: OPT is authorization, but not indefinite authorization.
  it("answers No to indefinite or unrestricted authorization for a candidate who needs sponsorship", () => {
    const p = { ...user.profile, citizenship: ["China"], workAuthorization: { authorizedCountries: ["United States"], needsSponsorship: true } };
    const yn = { kind: "select" as const, options: ["Yes", "No"] };
    const one = (label: string) => buildPlan(form([field(label, yn)]), p, user.bank).items[0]!;
    expect(one("Are you authorized to work in the United States on a fulltime and indefinite basis? If you are hired, you will be required to present documentation.")).toMatchObject({ status: "fill", value: "No" });
    expect(one("Are you legally authorized to work in the United States?")).toMatchObject({ status: "fill", value: "Yes" });
    expect(one("Are you a citizen of any one of these countries: Cuba, Iran, North Korea, or Syria?")).toMatchObject({ status: "fill", value: "No" });
    expect(one("Are you a citizen of any of the following countries: Group D (Armenia, Belarus, China (PRC), Hong Kong, Vietnam)")).toMatchObject({ status: "fill", value: "Yes" });
  });

  it("answers current enrollment from degree end dates", () => {
    const f = field("Are you currently enrolled in an accredited degree program?", { kind: "select", options: ["Yes", "No"] });
    const done = { ...user.profile, education: [{ ...user.profile.education[0]!, gradYear: 2026, gradMonth: 5 }] };
    expect(buildPlan(form([f]), done, user.bank).items[0]).toMatchObject({ status: "fill", value: "No" });
    const h = field("What is your highest level of education earned?", { kind: "select", options: ["Secondary / High School", "Bachelor's Degree", "Master's Degree", "Doctorate or Equivalent"] });
    expect(buildPlan(form([h]), done, user.bank).items[0]).toMatchObject({ status: "fill", value: "Master's Degree" });
  });

  // From ADI's Workday form: the one required box before Review.
  it("accepts an application's Terms and Conditions only when the candidate allowed it", () => {
    const f = field("I accept the Terms and Conditions.", { kind: "checkbox", options: ["I accept the Terms and Conditions.*"] });
    expect(buildPlan(form([f]), user.profile, user.bank).items[0]).toMatchObject({ status: "blocked" });
    expect(buildPlan(form([f]), { ...user.profile, acceptApplicationTerms: true }, user.bank).items[0]).toMatchObject({ status: "fill" });
    const gf = field("By submitting, you declare that you have read, understood, and accepted the terms in this policy", { kind: "checkbox", options: ["By submitting, you declare that you have read, understood, and accepted the terms in this policy*"] });
    expect(buildPlan(form([gf]), { ...user.profile, acceptApplicationTerms: true }, user.bank).items[0]).toMatchObject({ status: "fill" });
  });

  it("declines gender where the form allows it and uses the required-answer fallback otherwise", () => {
    const p = { ...user.profile, eeo: { ...user.profile.eeo, gender: "decline", genderIfRequired: "Female" } };
    const one = (options: string[]) => buildPlan(form([field("Gender", { kind: "select", options })]), p, user.bank).items[0]!;
    expect(one(["Female", "Male", "I don't wish to answer"])).toMatchObject({ status: "fill", value: "I don't wish to answer" });
    expect(one(["Female", "Male", "Non-Binary"])).toMatchObject({ status: "fill", value: "Female" });
    expect(one(["Female", "Male", "Non-Binary", "Not declared"])).toMatchObject({ status: "fill", value: "Not declared" });
  });

  it("answers Workday's veteran list with the plain not-a-veteran option", () => {
    const p = { ...user.profile, eeo: { ...user.profile.eeo, veteran: "no" } };
    const options = ["I IDENTIFY AS ONE OR MORE OF THE CLASSIFICATIONS OF PROTECTED VETERANS LISTED ABOVE", "I IDENTIFY AS A VETERAN, JUST NOT A PROTECTED VETERAN", "I AM NOT A VETERAN", "I DO NOT WISH TO SELF-IDENTIFY"];
    expect(buildPlan(form([field("Veterans status", { kind: "select", options })]), p, user.bank).items[0]).toMatchObject({ status: "fill", value: "I AM NOT A VETERAN" });
  });

  it("signs only the self-identification form, and only with the candidate's permission", () => {
    const sig = field("Self-identification form signature name");
    expect(buildPlan(form([sig]), user.profile, user.bank).items[0]).toMatchObject({ status: "blocked" });
    const p = { ...user.profile, signSelfIdentificationForms: true };
    expect(buildPlan(form([sig]), p, user.bank).items[0]).toMatchObject({ status: "fill", value: `${p.identity.firstName} ${p.identity.lastName}` });
    expect(buildPlan(form([field("Signature")]), p, user.bank).items[0]).toMatchObject({ status: "blocked" });
  });

  // From GlobalFoundries' Workday questionnaire.
  it("answers GlobalFoundries' contractor, relatives, re-application, clearance and history questions", () => {
    const p = { ...user.profile, citizenship: ["China"], relativesAtEmployers: false, workHistory: [{ employer: "Arborphy AI LLC", start: "2026-05" }] };
    const yn = { kind: "select" as const, options: ["Yes", "No"] };
    const one = (label: string, prior?: number) => buildPlan({ ...form([field(label, yn)], "GLOBAL FOUNDRIES"), ...(prior !== undefined ? { priorApplications: prior } : {}) }, p, user.bank).items[0]!;
    expect(one("Are you or have you in the past been a contingent work or contractor for GLOBAL FOUNDRIES?")).toMatchObject({ value: "No" });
    expect(one("Do you have relatives employed by GLOBAL FOUNDRIES?")).toMatchObject({ value: "No" });
    expect(one("Have you applied to GLOBAL FOUNDRIES within the past 6 months?", 0)).toMatchObject({ value: "No" });
    expect(one("Have you applied to GLOBAL FOUNDRIES within the past 6 months?", 1)).toMatchObject({ value: "Yes" });
    expect(one("Have you held an active U.S. security clearance within the last 2 years?")).toMatchObject({ value: "No" });
    const located = buildPlan({ ...form([field("Are you legally authorized to work for GLOBAL FOUNDRIES in the position's country?", yn)], "GLOBAL FOUNDRIES"), jobLocation: "USA - California - Santa Clara; United States of America" }, { ...p, workAuthorization: { authorizedCountries: ["United States"], needsSponsorship: true } }, user.bank).items[0]!;
    expect(located).toMatchObject({ status: "fill", value: "Yes" });
    expect(one("Have you previously worked for GLOBAL FOUNDRIES, IBM Microelectronics, or Chartered Semiconductor (including any joint-ventures or overseas locations)?")).toMatchObject({ value: "No" });
  });

  it("declines transgender identity, which the candidate has not answered", () => {
    const p = { ...user.profile, eeo: { ...user.profile.eeo, gender: "Female" } };
    const f = field("Do you identify as transgender?", { kind: "combobox", options: ["Yes", "No", "I don't wish to answer"] });
    expect(buildPlan(form([f]), p, user.bank).items[0]).toMatchObject({ status: "fill", value: "I don't wish to answer" });
  });

  it("uses a drafted answer only on the posting it was written for", () => {
    const why = { id: "draft:1", question: "Why are you interested in this role?", aliases: [], answer: "Because of the robots.", company: "Acme Robotics", jobTitle: "Intern", origin: "generated" as const };
    const f = field("Why are you interested in this role?");
    expect(buildPlan(form([f]), user.profile, { answers: [why] }).items[0]).toMatchObject({ status: "fill", value: "Because of the robots." });
    expect(buildPlan({ ...form([f]), jobTitle: "Staff Engineer" }, user.profile, { answers: [why] }).items[0]).toMatchObject({ status: "blocked" });
  });

  // Held on the VPS (2026-10-29): Ashby's composite education block, Affirm's employment and how-heard wording, Greenhouse's race reset.
  it("answers Ashby's education history, Affirm's wording, and leaves Greenhouse's declined race blank", () => {
    const p = { ...user.profile, education: [{ school: "Columbia University", degree: "Master of Science", major: "Statistics", start: "2024-09", gradMonth: 5, gradYear: 2026 }], workHistory: [{ employer: "Arborphy AI LLC" }], eeo: { ...user.profile.eeo, race: "decline" } };
    const one = (f: ReturnType<typeof field>, ats = "ashby") => buildPlan({ ...form([f], "Affirm"), ats: ats as "ashby" }, p, user.bank).items[0]!;
    expect(one(field("Education History"))).toMatchObject({ status: "fill", value: "Columbia University | Master of Science | Statistics | 09/2024 | 05/2026" });
    expect(one(field("Have you previously been employed at Affirm for any length of time?", { kind: "select", options: ["Yes", "No"] }))).toMatchObject({ value: "No" });
    expect(one(field("How did you first learn about Affirm as an employer?"))).toMatchObject({ status: "fill", value: "LinkedIn" });
    const race = { ...field("Please identify your race", { kind: "combobox", options: ["Asian", "Decline To Self Identify"] }), id: "race", required: false };
    expect(one(race, "greenhouse")).toMatchObject({ status: "skip" });
  });

  it("answers on-site and relocation questions for US postings from her stated arrangement, and pronouns by declining", () => {
    const p = { ...user.profile, workArrangement: { onsite: true, relocate: true } };
    const yn = { kind: "radio" as const, options: ["Yes", "No"] };
    const at = (label: string, loc: string, over: Partial<ReturnType<typeof field>> = yn) => buildPlan({ ...form([field(label, over)]), jobLocation: loc }, p, user.bank).items[0]!;
    expect(at("Are you open to being in-office 5 days a week in Sunnyvale?", "Sunnyvale, CA")).toMatchObject({ status: "fill", value: "Yes" });
    expect(at("Are you willing to relocate for this position if required?", "New York, NY", { kind: "radio", options: ["Yes", "No", "I'm already located where the position is based"] })).toMatchObject({ value: "Yes" });
    expect(at("Are you open to being in-office 5 days a week in London?", "London, UK")).toMatchObject({ status: "blocked" });
    expect(at("Will you require relocation support?", "New York, NY")).toMatchObject({ status: "blocked" });
    expect(at("Pronouns", "New York, NY", { kind: "combobox", options: ["She/her/hers", "I prefer not to say"] })).toMatchObject({ value: "I prefer not to say" });
    expect(at("Have you previously been employed at Acme Robotics for any length of time?", "New York, NY", { kind: "combobox", options: ["I have not previously been employed at Acme Robotics", "I have been employed at Acme Robotics as an intern"] })).toMatchObject({ value: "I have not previously been employed at Acme Robotics" });
  });

  // Held on 2026-10-29 (jh holds): the recurring questions behind most Greenhouse and Workday holds.
  it("answers the recurring held questions from the profile", () => {
    const p = {
      ...user.profile,
      education: [
        { school: "Columbia University", degree: "Master of Science", major: "Statistics", gpa: "3.71", gradMonth: 5, gradYear: 2026 },
        { school: "Renmin University of China", degree: "Bachelor of Arts", major: "Economics", gpa: "3.82", gradMonth: 6, gradYear: 2023 },
      ],
      workHistory: [{ employer: "Arborphy AI LLC" }],
      relativesAtEmployers: false,
      consentAiScreening: true,
      workArrangement: { onsite: true, relocate: true },
      eeo: { ...user.profile.eeo, disability: "no" },
    };
    const yn = { kind: "select" as const, options: ["Yes", "No"] };
    const one = (label: string, company: string, over: Partial<ReturnType<typeof field>> = {}, loc = "New York, NY") => buildPlan({ ...form([field(label, over)], company), jobLocation: loc }, p, user.bank).items[0]!;
    expect(one("Given Name(s)", "Adobe")).toMatchObject({ value: p.identity.firstName });
    expect(one("What is your Legal Last Name?", "Block")).toMatchObject({ value: p.identity.lastName });
    expect(one("What is your GPA?", "Klaviyo")).toMatchObject({ value: "3.71" });
    expect(one("What is your anticipated graduation month/year?", "Klaviyo")).toMatchObject({ value: "05/2026" });
    expect(one("Where did you complete your undergraduate degree?", "Bertram")).toMatchObject({ value: "Renmin University of China" });
    expect(one('Have you been employed, or otherwise engaged, by an Asana entity in the past? (Previous independent contractors, select "Yes.")', "Asana", yn)).toMatchObject({ value: "No" });
    expect(one("Have you ever provided any contract work for Block, Inc. or any of its subsidiaries or affiliates?", "Block", yn)).toMatchObject({ value: "No" });
    expect(one("Have you worked at DoorDash?", "DoorDash", { kind: "select", options: ["Yes, as an employee", "Yes, as a contractor", "No"] })).toMatchObject({ value: "No" });
    expect(one("Do you currently work at a Crowe client?", "Crowe", yn)).toMatchObject({ status: "blocked" });
    expect(one("Do you have a familial (by blood or marriage), romantic, or close personal relationship with a Crowe employee or applicant?", "Crowe", yn)).toMatchObject({ value: "No" });
    expect(one("Can you perform these essential functions of the job with reasonable accommodation?", "Lyft", yn)).toMatchObject({ value: "Yes" });
    expect(one("This position is based in the United States. Do you currently reside in commutable proximity to a Lyft Office located in San Francisco or are you open to relocating?", "Lyft", { kind: "select", options: ["Yes, I live within commuting distance", "Yes, I am open to relocating", "No"] }, "San Francisco, CA")).toMatchObject({ value: "Yes, I am open to relocating" });
    expect(one("Are you interested in working out of our Miami HQ?", "OneImaging", yn, "Miami, FL")).toMatchObject({ value: "Yes" });
    expect(one("Just-In-Time Notice: We use an AI-assisted resume-screening tool to help recruiters manage applications.", "Crowe", { kind: "select", options: ["Opt In", "Opt Out"] })).toMatchObject({ value: "Opt In" });
    expect(one("We would like to contact you via SMS or WhatsApp to provide updates on your progress. Mark yes if you agree.", "DoorDash", yn)).toMatchObject({ value: "No" });
  });

  it("agrees to certifications, arbitration, interview rules and recording only with her permission, and nothing broader", () => {
    const p = { ...user.profile, acceptApplicationAttestations: true };
    const one = (label: string, over: Partial<ReturnType<typeof field>>, prof = p) => buildPlan(form([field(label, over)]), prof, user.bank).items[0]!;
    const certify = "I certify that the facts set forth in this Application for Employment are true and complete to the best of my knowledge.";
    expect(one(certify, { kind: "checkbox", options: ["I agree"] })).toMatchObject({ status: "fill", value: "I agree" });
    expect(one(certify, { kind: "checkbox", options: ["I agree"] }, user.profile)).toMatchObject({ status: "blocked" });
    expect(one("By clicking accept, you agree that any disputes shall be submitted to binding arbitration.", { kind: "select", options: ["Accept", "Decline"] })).toMatchObject({ value: "Accept" });
    expect(one("I consent to my interview being recorded via BrightHire, Inc. to assist in our recruiting efforts.", { kind: "select", options: ["Yes", "No"] })).toMatchObject({ value: "Yes" });
    expect(one("By checking this box, I consent to Pinterest collecting, storing, and processing my responses to the demographic data surveys above.", { kind: "checkbox", options: ["By checking this box, I consent to Pinterest collecting, storing, and processing my responses to the demographic data surveys above."] })).toMatchObject({ status: "fill" });
    expect(one("Have you ever been convicted or do you have a criminal record?", { kind: "select", options: ["Yes", "No"] })).toMatchObject({ status: "blocked" });
    expect(one("Do you use AI tools in your daily work?", { kind: "select", options: ["Yes", "No"] })).toMatchObject({ status: "blocked" });
    expect(one("Signature: I certify the above is true and complete", { kind: "text" })).toMatchObject({ status: "blocked" });
  });

  it("answers Lyft's relocation options by her metro, and Asana's government-employment pair", () => {
    const p = { ...user.profile, contact: { ...user.profile.contact, address: { ...user.profile.contact.address, city: "Flushing", state: "NY" } }, workArrangement: { onsite: true, relocate: true }, workHistory: [{ employer: "Arborphy AI LLC" }] };
    const lyft = ["I am willing to relocate before starting employment.", "I am not willing to relocate before starting employment.", "I already reside near a Lyft office and I am able to work at a Lyft On-site Office."];
    const q = (city: string) => `This position is based in the United States. Do you currently reside in commutable proximity to a Lyft Office located in ${city} or are you open to relocating?`;
    const one = (label: string, over: Partial<ReturnType<typeof field>>, loc: string) => buildPlan({ ...form([field(label, over)], "Lyft"), jobLocation: loc }, p, user.bank).items[0]!;
    expect(one(q("New York City"), { kind: "combobox", options: lyft }, "New York, NY")).toMatchObject({ value: lyft[2] });
    expect(one(q("San Francisco"), { kind: "combobox", options: lyft }, "San Francisco, CA")).toMatchObject({ value: lyft[0] });
    expect(one("Do you currently work for or have you ever worked for a U.S. government entity, either as a contractor or employee?", { kind: "combobox", options: ["Yes, I do work/have worked for a U.S. government entity.", "No, I have never."] }, "New York, NY")).toMatchObject({ value: "No, I have never." });
    expect(one("If you answered “Yes,” please list the U.S. government entity you worked for. If not applicable, type 'N/A.'", { kind: "text" }, "New York, NY")).toMatchObject({ value: "N/A" });
  });

  it("uploads a cover letter written for the employer, and only where the form requires one", () => {
    const p = { ...user.profile, documents: { ...user.profile.documents, coverLetters: { "acme-robotics": "/letters/acme-robotics.pdf" } } };
    const f = (required: boolean) => ({ ...field("Cover Letter", { kind: "file" }), required });
    expect(buildPlan(form([f(true)]), p, user.bank).items[0]).toMatchObject({ status: "fill", value: "/letters/acme-robotics.pdf" });
    expect(buildPlan(form([f(false)]), p, user.bank).items[0]).toMatchObject({ status: "skip" });
    expect(buildPlan(form([f(true)], "Other Co"), p, user.bank).items[0]).toMatchObject({ status: "blocked" });
  });

  it("maps her answers onto choice lists: graduation, GPA ranges, notice period, degree, clearance, acronyms", () => {
    const p = {
      ...user.profile,
      education: [{ school: "Columbia University", degree: "Master of Science", major: "Statistics", gpa: "3.71", gradMonth: 5, gradYear: 2026 }],
      noticePeriodWeeks: 2,
      citizenship: ["China"],
      workHistory: [{ employer: "Arborphy AI LLC" }],
      relativesAtEmployers: false,
      workArrangement: { onsite: true, relocate: true },
    };
    const bank = { answers: [{ id: "notice", question: "What is your current notice period?", aliases: [], answer: "2 weeks", origin: "human" as const }] };
    const one = (label: string, options: string[], company = "Acme Robotics", kind: "combobox" | "checkbox" = "combobox", loc = "Boston, MA") => buildPlan({ ...form([field(label, { kind, options })], company), jobLocation: loc }, p, bank).items[0]!;
    expect(one("What is your anticipated graduation month/year?", ["December 2025", "May 2026", "Other"])).toMatchObject({ value: "May 2026" });
    expect(one("What is your GPA?", ["3.25 - 3.49", "3.5 - 3.74", "3.75 - 4", "4+"])).toMatchObject({ value: "3.5 - 3.74" });
    expect(one("What is your current notice period?", ["Immediately Available", "1 Month", "2 Months", "3+ Months"])).toMatchObject({ value: "1 Month" });
    expect(one("Degree", ["Bachelor's Degree", "Master’s Degree", "Other"])).toMatchObject({ value: "Master’s Degree" });
    expect(one("Do you hold a security clearance?", ["None", "Secret", "Top Secret"])).toMatchObject({ value: "None" });
    expect(one("Are you currently or have you ever previously been employed by AIR, IMPAQ, or Kimetrica? (not in a temp or contractor capacity)", ["Yes", "No"], "American Institutes for Research")).toMatchObject({ value: "No" });
    expect(one("Do you have any family members or people you have close relationships with who work for Accenture Federal Services?", ["Yes", "No"], "Accenture Federal Services")).toMatchObject({ value: "No" });
    expect(one("Are you a current employee of the U.S. Government (including U.S. Congress or military)?", ["Yes", "No"])).toMatchObject({ value: "No" });
    expect(one("Are you able to work in the specified job location, or are you willing to relocate for this position?", ["Yes", "No"], "Lila Sciences", "checkbox", "Cambridge, MA USA; San Francisco, CA USA")).toMatchObject({ value: "Yes" });
  });

  it("keys employer-page Greenhouse postings by job id, and reads Billtrust's and Bracebridge's wording", async () => {
    const { applicationKey } = await import("../src/domain/form.ts");
    expect(applicationKey("greenhouse", "https://www.billtrust.com/careers/job-openings?gh_jid=7790504003")).toBe("greenhouse:www.billtrust.com/careers/job-openings/7790504003");
    expect(applicationKey("greenhouse", "https://job-boards.greenhouse.io/pinterest/jobs/8140219")).toBe("greenhouse:job-boards.greenhouse.io/pinterest/jobs/8140219");
    const p = { ...user.profile, workHistory: [{ employer: "Arborphy AI LLC", start: "2026-05" }], education: [{ school: "Columbia University", degree: "Master of Science", major: "Statistics", gradMonth: 5, gradYear: 2026 }, { school: "Renmin University of China", degree: "Bachelor of Arts", major: "Economics", gradMonth: 6, gradYear: 2023 }] };
    const one = (label: string) => buildPlan(form([field(label)]), p, user.bank).items[0]!;
    expect(one("Current or most recent employer")).toMatchObject({ value: "Arborphy AI LLC" });
    expect(one("What year did/will you complete your undergraduate degree?")).toMatchObject({ value: "2023" });
  });
});
