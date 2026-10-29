import { basename } from "node:path";
import type { FormField } from "../domain/form.ts";
import type { FillPlan } from "../plan/plan.ts";
import { DECLINE, normalize } from "../plan/text.ts";

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

// A search box (location, school) offers the service's own wording: "New York,
// NY, United States" for "New York, New York, United States". An option fits
// when it is the value, extends it, or names the same first place.
export function searchMatch(expected: string, option: string): boolean {
  const e = normalize(expected);
  const o = normalize(option);
  if (!e || !o) return false;
  if (o === e || o.startsWith(`${e} `)) return true;
  return normalize(expected.split(",")[0]!) === normalize(option.split(",")[0]!);
}

function same(field: FormField, expected: string, actual: string, isPhone: boolean): boolean {
  if (field.kind === "file") return actual === basename(expected);
  // A planned "decline" on a menu read only at fill time: any decline option is it, nothing else.
  if (expected === "decline") return DECLINE.test(normalize(actual));
  if (field.kind === "combobox" && field.options.length === 0) return searchMatch(expected, actual);
  // Workday: an option that is a category takes a choice inside it ("Internet Job Board › Other").
  if (field.kind === "combobox" && actual.startsWith(`${expected} › `)) return true;
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
