import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Job, JobKey } from "../domain/job.ts";

// One line per posting ever seen, with every source's first and last sighting.
// Rewritten whole after each discovery run; history lives in the source records.
// Descriptions are kept only where triage read past the title, and capped, so
// the file stays small enough to commit and carry between sessions.
const KEEP_DESCRIPTION = 4000;

export function readCatalog(path: string): Map<JobKey, Job> {
  const out = new Map<JobKey, Job>();
  if (!existsSync(path)) return out;
  for (const l of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
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
      const titleOnly = ["role.out_of_scope", "type.internship", "level.senior", "role.non_engineering", "degree.phd_required", "location.non_us", "source.closed"].includes(j.triage.rule);
      return JSON.stringify({ ...j, description: titleOnly ? "" : j.description.slice(0, KEEP_DESCRIPTION) });
    });
  writeFileSync(path, lines.join("\n") + "\n");
}
