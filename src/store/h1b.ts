import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { employerKey, type H1bRecord } from "../discover/h1b.ts";

const file = (dataDir: string) => join(dataDir, "h1b", "sponsors.json");

export function readH1b(dataDir: string): Map<string, H1bRecord> {
  const f = file(dataDir);
  if (!existsSync(f)) return new Map();
  return new Map(Object.entries(JSON.parse(readFileSync(f, "utf8")) as Record<string, H1bRecord>));
}

export function writeH1b(dataDir: string, records: Map<string, H1bRecord>): void {
  const f = file(dataDir);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, `${JSON.stringify(Object.fromEntries([...records].sort(([a], [b]) => a.localeCompare(b))), null, 1)}\n`);
}

export const h1bKey = employerKey;
