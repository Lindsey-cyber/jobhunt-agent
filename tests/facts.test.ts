import { describe, expect, it } from "vitest";
import { buildPlan } from "../src/plan/plan.ts";
import { acceptMapping, factSheet } from "../src/plan/facts.ts";
import { field, form, makeUserData } from "./helpers.ts";

const user = makeUserData();

describe("answering from facts", () => {
  const facts = new Map(factSheet(user.profile, user.bank).map((f) => [f.id, f]));
  it("lists profile fields and her answers as facts with ids", () => {
    expect(facts.get("profile:workAuthorization.needsSponsorship")?.value).toBe(String(user.profile.workAuthorization.needsSponsorship));
    const withAnswer = factSheet(user.profile, { answers: [{ id: "visa-status", question: "What is your current visa status?", aliases: [], answer: "F-1 OPT", origin: "human" }] });
    expect(withAnswer.find((f) => f.id === "answer:visa-status")?.value).toBe("F-1 OPT");
  });
  it("accepts a mapping only when it cites a fact and picks an offered option", () => {
    const m = { question: "Do you need a visa to work here?", options: ["Yes", "No"], fact: "profile:workAuthorization.needsSponsorship", answer: "Yes", reason: "", by: "t", at: "" };
    expect(acceptMapping(m, facts)).toMatchObject({ origin: "fact", answer: "Yes" });
    expect(acceptMapping({ ...m, fact: "profile:nope" }, facts)).toBeUndefined();
    expect(acceptMapping({ ...m, fact: "none" }, facts)).toBeUndefined();
    expect(acceptMapping({ ...m, answer: "Maybe" }, facts)).toBeUndefined();
  });
  it("answers the mapped question exactly and never a look-alike", () => {
    const entry = acceptMapping({ question: "What is your Current Legal Status?", fact: "profile:workAuthorization.needsSponsorship", answer: "F-1 OPT", reason: "", by: "t", at: "" }, facts)!;
    const bank = { answers: [...user.bank.answers, entry] };
    expect(buildPlan(form([field("What is your Current Legal Status?")]), user.profile, bank).items[0]).toMatchObject({ status: "fill", value: "F-1 OPT" });
    expect(buildPlan(form([field("What is your current legal name status?")]), user.profile, bank).items[0]).not.toMatchObject({ value: "F-1 OPT" });
  });
});
