import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Job, JobKey } from "../domain/job.ts";

// One line per posting ever seen, with every source's first and last sighting.
// Rewritten whole after each discovery run; history lives in the source records.
// Descriptions are kept, whole, only where triage read past the title: rules
// such as an ITAR clause often sit at the very end, and labels store this text
// as their evidence. The plain file is ignored by git; a gzip copy next
// to it is committed so a fresh cloud session keeps first-seen history.
// Rules decided from the title or location alone. A rule that can also fire on
// the description (degree.phd_required, auth.citizenship) must not be listed.
export const TITLE_RULES = ["role.out_of_scope", "type.internship", "level.senior", "role.non_engineering", "location.non_us", "source.closed"];

export function readCatalog(path: string): Map<JobKey, Job> {
  const out = new Map<JobKey, Job>();
  const text = existsSync(path) ? readFileSync(path, "utf8") : existsSync(`${path}.gz`) ? gunzipSync(readFileSync(`${path}.gz`)).toString("utf8") : "";
  for (const l of text.split("\n").filter(Boolean)) {
    const j = JSON.parse(l) as Job;
    out.set(j.key, j);
  }
  return out;
}

export function writeCatalog(path: string, jobs: Iterable<Job>): void {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [...jobs]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((j) => {
      // Hiring posts keep their text whatever triage said: outreach reads it.
      const post = j.sources.some((s) => s.channel === "hn_hiring");
      const titleOnly = !post && TITLE_RULES.includes(j.triage.rule);
      return JSON.stringify({ ...j, description: titleOnly ? "" : j.description });
    });
  const text = lines.join("\n") + "\n";
  writeFileSync(path, text);
  writeFileSync(`${path}.gz`, gzipSync(text, { level: 9 }));
}
