import { describe, expect, it } from "vitest";
import { gate } from "../src/gate/gate.ts";
import { buildPlan } from "../src/plan/plan.ts";
import { Config } from "../src/profile/schema.ts";
import type { VerifyReport } from "../src/verify/compare.ts";
import { field, form, makeUserData } from "./helpers.ts";

const user = makeUserData();
const ok: VerifyReport = { ok: true, checks: [], emptyRequired: [] };
const auto = Config.parse({ trust: "auto", autoSubmitAts: ["greenhouse"] });
const greenPlan = buildPlan(form([field("First Name"), field("Email")]), user.profile, user.bank);
const run = (over: Partial<Parameters<typeof gate>[0]>) => gate({ plan: greenPlan, verify: ok, config: auto, submittedToday: 0, approved: false, ...over });

describe("gate", () => {
  it("submits a fully green, verified plan at trust auto", () => {
    expect(run({})).toEqual({ decision: "submit" });
  });

  it("holds everything at trust draft unless a human approved the run", () => {
    expect(run({ config: Config.parse({}) }).decision).toBe("hold");
    expect(run({ config: Config.parse({}), approved: true })).toEqual({ decision: "submit" });
  });

  it("holds a blocked field even with approval", () => {
    const plan = buildPlan(form([field("What are your salary expectations?")]), user.profile, user.bank);
    expect(run({ plan, approved: true }).decision).toBe("hold");
  });

  it("holds a failed readback even with approval", () => {
    const verify: VerifyReport = { ok: false, checks: [{ fieldId: "email", label: "Email", expected: "a", actual: "b", pass: false }], emptyRequired: [] };
    expect(run({ verify, approved: true }).decision).toBe("hold");
  });

  it("holds unapproved generated answers", () => {
    const bank = { answers: [{ id: "g", question: "Why us?", aliases: [], answer: "Drafted.", origin: "generated" as const }] };
    const plan = buildPlan(form([field("Why us?", { kind: "textarea" })]), user.profile, bank);
    expect(run({ plan }).decision).toBe("hold");
    expect(run({ plan, config: { ...auto, allowGeneratedAnswers: true } })).toEqual({ decision: "submit" });
  });

  it("holds any filled item that has no source", () => {
    const item = greenPlan.items.find((i) => i.status === "fill")!;
    const { source: _dropped, ...bare } = item as typeof item & { source: unknown };
    const plan = { ...greenPlan, items: [bare as never, ...greenPlan.items.slice(1)] };
    expect(run({ plan, approved: true })).toMatchObject({ decision: "hold" });
    expect(JSON.stringify(run({ plan, approved: true }))).toContain("without a source");
  });

  it("holds an unapproved unsourced fill with only the source reason, without throwing", () => {
    const item = greenPlan.items.find((i) => i.status === "fill")!;
    const { source: _dropped, ...bare } = item as typeof item & { source: unknown };
    const plan = { ...greenPlan, items: [bare as never, ...greenPlan.items.slice(1)] };
    let result: ReturnType<typeof gate> | undefined;
    expect(() => {
      result = run({ plan, approved: false });
    }).not.toThrow();
    expect(result).toMatchObject({ decision: "hold" });
    expect((result as { reasons: string[] }).reasons).toEqual([`"${item.field.label}" is filled without a source`]);
  });

  it("holds at the daily cap", () => {
    expect(run({ submittedToday: auto.dailySubmitCap }).decision).toBe("hold");
  });
});
