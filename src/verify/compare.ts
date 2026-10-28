import { basename } from "node:path";
import type { FormField } from "../domain/form.ts";
import type { FillPlan } from "../plan/plan.ts";
import { normalize } from "../plan/text.ts";

export interface FieldCheck {
  fieldId: string;
  label: string;
  expected: string;
  actual: string;
  pass: boolean;
}

export interface VerifyReport {
  ok: boolean;
  checks: FieldCheck[];
  emptyRequired: string[];
}

export type Readback = Record<string, string>;

function same(field: FormField, expected: string, actual: string, isPhone: boolean): boolean {
  if (field.kind === "file") return actual === basename(expected);
  if (isPhone) return expected.replace(/\D/g, "").endsWith(actual.replace(/\D/g, "")) && actual.replace(/\D/g, "").length >= 7;
  return normalize(actual) === normalize(expected);
}

// `fieldsNow` is the form re-extracted after filling, so a required field that
// appeared mid-fill (conditional questions) is caught too.
export function compareReadback(plan: FillPlan, fieldsNow: FormField[], readback: Readback): VerifyReport {
  const checks: FieldCheck[] = [];
  for (const item of plan.items) {
    if (item.status !== "fill") continue;
    const actual = readback[item.field.id] ?? "";
    const isPhone = item.source.type === "profile" && item.source.path === "contact.phone";
    checks.push({
      fieldId: item.field.id,
      label: item.field.label,
      expected: item.field.kind === "file" ? basename(item.value) : item.value,
      actual,
      pass: same(item.field, item.value, actual, isPhone),
    });
  }
  const emptyRequired = fieldsNow.filter((f) => f.required && !(readback[f.id] ?? "").trim()).map((f) => f.label);
  return { ok: checks.every((c) => c.pass) && emptyRequired.length === 0, checks, emptyRequired };
}
