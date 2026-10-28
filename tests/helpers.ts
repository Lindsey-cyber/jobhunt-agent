import { mkdtempSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import type { FormField, FormSnapshot } from "../src/domain/form.ts";
import { loadUserData, type UserData } from "../src/profile/load.ts";
import type { AnswerBank, Config } from "../src/profile/schema.ts";

export function makeUserData(opts: { config?: Partial<Config>; bank?: AnswerBank } = {}): UserData {
  const dir = mkdtempSync(join(tmpdir(), "jh-"));
  copyFileSync(join(import.meta.dirname, "../examples/profile.example.yaml"), join(dir, "profile.yaml"));
  writeFileSync(join(dir, "resume.pdf"), "%PDF-1.4\n% placeholder resume\n");
  writeFileSync(join(dir, "config.yaml"), stringify(opts.config ?? {}));
  writeFileSync(join(dir, "answers.yaml"), stringify(opts.bank ?? { answers: [] }));
  return loadUserData(dir);
}

export function field(label: string, over: Partial<FormField> = {}): FormField {
  return { id: label.toLowerCase().replace(/\W+/g, "_"), label, kind: "text", required: true, options: [], ...over };
}

export function form(fields: FormField[], company = "Acme Robotics"): FormSnapshot {
  return { ats: "greenhouse", url: "https://job-boards.greenhouse.io/acme/jobs/1", company, jobTitle: "Intern", fields };
}
