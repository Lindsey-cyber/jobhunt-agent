import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AnswerEntry } from "../profile/schema.ts";

// Answers the agent records while it runs (jh answer, drafted answers), kept
// apart from the hand-kept answers.yaml. Append-only, last line per id wins,
// so the VPS and a cloud session can both add to it and git merges it line by
// line (.gitattributes). A line {"id", "withdrawn": true} retires an entry.
export const answerLogPath = (dir: string) => join(dir, "answers.jsonl");

type Line = AnswerEntry | { id: string; withdrawn: true };

export function readAnswerLog(dir: string): AnswerEntry[] {
  const path = answerLogPath(dir);
  if (!existsSync(path)) return [];
  const byId = new Map<string, Line>();
  for (const l of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
    const line = JSON.parse(l) as Line;
    byId.set(line.id, line);
  }
  return [...byId.values()].filter((l): l is AnswerEntry => !("withdrawn" in l)).map((a) => ({ ...a, aliases: a.aliases ?? [] }));
}

export function appendAnswer(dir: string, entry: AnswerEntry | { id: string; withdrawn: true }): void {
  appendFileSync(answerLogPath(dir), JSON.stringify(entry) + "\n");
}
