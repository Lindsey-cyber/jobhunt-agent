import { describe, expect, it } from "vitest";
import { checkDraft } from "../src/verify/grounding.ts";

// Lines as pdftotext gives them from the candidate's resume, hyphenation included.
const resume = `• Developed a real-time vision pipeline for an autonomous badminton-training robot, integrating YOLOv8-
   based player detection, pose estimation, shuttlecock tracking, and court localization, achieving 20+ FPS.`;

describe("drafted answers", () => {
  it("accepts an answer whose citations and numbers come from the resume", () => {
    const d = { answer: "I built a real-time vision pipeline for a badminton robot running at 20+ FPS.", evidence: ["integrating YOLOv8-based player detection, pose estimation"] };
    expect(checkDraft(d, [resume], "")).toEqual({ ok: true, problems: [] });
  });

  it("rejects an invented citation, an invented number and an answer outside the options", () => {
    const d = { answer: "Yes, it served 2 million users.", evidence: ["deployed to 2 million production users"] };
    const r = checkDraft(d, [resume], "", ["Yes", "No"]);
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toMatch(/not one of the options/);
    expect(r.problems.join("\n")).toMatch(/citation not in the resume/);
    expect(r.problems.join("\n")).toMatch(/number 2 appears in no source/);
  });

  it("needs a citation for a Yes but not for a No", () => {
    expect(checkDraft({ answer: "Yes", evidence: [] }, [resume], "", ["Yes", "No"]).ok).toBe(false);
    expect(checkDraft({ answer: "No", evidence: [] }, [resume], "", ["Yes", "No"]).ok).toBe(true);
  });

  it("needs a cited passage for any answer to a sensitive question, No included", () => {
    const docs = ["Authorized to work in the United States on F-1 OPT"];
    expect(checkDraft({ answer: "No", evidence: [] }, docs, "", ["Yes", "No"], true).ok).toBe(false);
    expect(checkDraft({ answer: "No", evidence: [] }, docs, "", ["Yes", "No"]).ok).toBe(true);
  });
});
