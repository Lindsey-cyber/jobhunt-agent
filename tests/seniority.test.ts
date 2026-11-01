import { describe, expect, it } from "vitest";
import { tooSenior } from "../src/discover/seniority.ts";

describe("tooSenior", () => {
  it("skips senior, staff, principal and lead roles", () => {
    for (const t of ["Senior Machine Learning Engineer, Scenes", "Senior / Staff Software Engineer — AI / ML", "Staff AI/ML Engineer", "Principal Data Scientist", "Lead ML Engineer", "Sr. Data Scientist", "Software Engineer III", "Staff AI/ML Engineer", "Senior / Staff ML Engineer"]) expect(tooSenior(t), t).toBe(true);
  });
  it("keeps early-career and mixed-level titles", () => {
    for (const t of ["Machine Learning Engineer II", "[Junior / Senior / Staff] Software Engineer, Inference", "Senior / Engineer II, AI Lab Research Engineer", "Member of Technical Staff — Model Optimization (New Grad)", "Member of Technical Staff, Inference", "Data Scientist", "AI Engineer (Junior/Senior)", "Senior/Software Engineer (AI-Powered Advertising Agents)", "Data Scientist / Senior Data Scientist"]) expect(tooSenior(t), t).toBe(false);
  });
});
