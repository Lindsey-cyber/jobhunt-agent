import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelVerdict } from "../discover/modeltriage.ts";

// The model triage's verdicts: append-only, last line per posting wins, merged
// line by line between machines (.gitattributes data/*.jsonl).
export const modelVerdictsPath = (dir: string) => join(dir, "model-triage.jsonl");

export function readModelVerdicts(dir: string): Map<string, ModelVerdict> {
  const path = modelVerdictsPath(dir);
  const out = new Map<string, ModelVerdict>();
  if (!existsSync(path)) return out;
  for (const l of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
    const v = JSON.parse(l) as ModelVerdict;
    out.set(v.key, v);
  }
  return out;
}

export function appendModelVerdicts(dir: string, vs: ModelVerdict[]): void {
  if (vs.length) appendFileSync(modelVerdictsPath(dir), vs.map((v) => JSON.stringify(v)).join("\n") + "\n");
}
