// Employers the candidate does not want to apply to. Applied after triage, so a
// posting can be a fit by the rules and still be excluded by preference.
import type { Job, Triage } from "../domain/job.ts";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function excludedBy(company: string, exclude: readonly string[]): string | undefined {
  return exclude.find((name) => new RegExp(`(^|[^a-z0-9])${escape(name.toLowerCase())}($|[^a-z0-9])`).test(company.toLowerCase()));
}

export function applyExclusions(j: Job, exclude: readonly string[]): Triage {
  const name = excludedBy(j.company, exclude);
  return name ? { verdict: "reject", rule: "company.excluded", reason: `The candidate excluded ${name}` } : j.triage;
}
