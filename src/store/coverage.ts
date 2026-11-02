import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Coverage } from "../discover/gates.ts";

export interface CoverageRead { coverage?: Coverage; problem?: string }

// Why a parsed measurement cannot be trusted, or undefined when it is sound.
export function coverageProblem(c: unknown): string | undefined {
  if (!c || typeof c !== "object") return "不是对象";
  const { date, n, inCatalog, inCatalogNotRejected } = c as Record<string, unknown>;
  if (typeof date !== "string" || Number.isNaN(Date.parse(date))) return "date 无效";
  const counts = [n, inCatalog, inCatalogNotRejected];
  if (!counts.every((x) => typeof x === "number" && Number.isFinite(x))) return "计数不是数字";
  if (!Number.isInteger(n)) return "n 不是整数";
  if (counts.some((x) => (x as number) < 0)) return "计数为负";
  if ((inCatalog as number) > (n as number)) return "inCatalog 大于 n";
  if ((inCatalogNotRejected as number) > (inCatalog as number)) return "inCatalogNotRejected 大于 inCatalog";
  return undefined;
}

// The newest data/coverage/<date>.json. A newest file that is unreadable or inconsistent counts as
// missing (no fallback to an older one) and says why.
export function readCoverage(dataDir: string): CoverageRead {
  const dir = join(dataDir, "coverage");
  if (!existsSync(dir)) return {};
  const newest = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().at(-1);
  if (!newest) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(dir, newest), "utf8"));
  } catch {
    return { problem: `${newest} 无法读取` };
  }
  const why = coverageProblem(parsed);
  return why ? { problem: `${newest} 被拒绝：${why}` } : { coverage: parsed as Coverage };
}

export const readLatestCoverage = (dataDir: string): Coverage | undefined => readCoverage(dataDir).coverage;
