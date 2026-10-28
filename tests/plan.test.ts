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
});
