import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { EvalScore, Label } from "../discover/evalset.ts";
import { initialStage, type Stage, type StageState } from "../discover/stagetrust.ts";

// Small agent-owned state files under the data dir. config.yaml and
// ledger.jsonl stay the candidate's; these the agent may write.
export const paths = (dataDir: string) => ({
  catalog: join(dataDir, "discovery", "catalog.jsonl"),
  latest: join(dataDir, "discovery", "latest.json"),
  review: join(dataDir, "review.jsonl"),
  trust: join(dataDir, "trust.json"),
  labels: join(dataDir, "labels", "triage.jsonl"),
  baseline: join(dataDir, "labels", "triage-baseline.json"),
});

const readJson = <T>(p: string, fallback: T): T => (existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : fallback);
const writeJson = (p: string, v: unknown) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
};

export interface LatestRun {
  runDir: string;
  reportDir: string;
  startedAt: string;
  finishedAt: string;
  inboxMessages: number;
  auditSeed: number;
}

export const readLatest = (dataDir: string) => readJson<LatestRun | null>(paths(dataDir).latest, null);
export const writeLatest = (dataDir: string, v: LatestRun) => writeJson(paths(dataDir).latest, v);

export function readTrust(dataDir: string): Record<Stage, StageState> {
  const at = new Date().toISOString();
  const t = readJson<Partial<Record<Stage, StageState>>>(paths(dataDir).trust, {});
  return { triage: t.triage ?? initialStage(at), apply: t.apply ?? initialStage(at), outreach: t.outreach ?? initialStage(at) };
}
export const writeTrust = (dataDir: string, t: Record<Stage, StageState>) => writeJson(paths(dataDir).trust, t);

export function readLabels(dataDir: string): Label[] {
  const p = paths(dataDir).labels;
  return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Label) : [];
}
export function appendLabel(dataDir: string, l: Label): void {
  const p = paths(dataDir).labels;
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, JSON.stringify(l) + "\n");
}

export const readBaseline = (dataDir: string) => readJson<EvalScore | null>(paths(dataDir).baseline, null);
export const writeBaseline = (dataDir: string, s: EvalScore) => writeJson(paths(dataDir).baseline, s);
