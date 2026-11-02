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
  const stale = (c as Record<string, unknown>).staleExcluded;
  if (stale !== undefined && !(typeof stale === "number" && Number.isInteger(stale) && stale >= 0)) return "staleExcluded 不是非负整数";
  const bands = (c as Record<string, unknown>).bands;
  if (bands !== undefined) {
    if (!bands || typeof bands !== "object" || Array.isArray(bands)) return "bands 不是对象";
    const b = bands as Record<string, unknown>;
    let sum = 0;
    for (const k of ["large", "mid", "small", "unknown"]) {
      const v = b[k] as Record<string, unknown> | undefined;
      if (!v || typeof v !== "object") return `bands.${k} 缺失`;
      const { n: bn, inCatalog: bi, inCatalogNotRejected: br } = v;
      if (![bn, bi, br].every((x) => typeof x === "number" && Number.isInteger(x) && x >= 0)) return `bands.${k} 的计数不是非负整数`;
      if ((bi as number) > (bn as number)) return `bands.${k}.inCatalog 大于 n`;
      if ((br as number) > (bi as number)) return `bands.${k}.inCatalogNotRejected 大于 inCatalog`;
      sum += bn as number;
    }
    const total = (k: "inCatalog" | "inCatalogNotRejected") => ["large", "mid", "small", "unknown"].reduce((a, x) => a + ((b[x] as Record<string, number>)[k] ?? 0), 0);
    if (sum !== n) return "bands 的 n 之和不等于 n";
    if (total("inCatalog") !== inCatalog) return "bands 的 inCatalog 之和不等于 inCatalog";
    if (total("inCatalogNotRejected") !== inCatalogNotRejected) return "bands 的 inCatalogNotRejected 之和不等于 inCatalogNotRejected";
  }
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

