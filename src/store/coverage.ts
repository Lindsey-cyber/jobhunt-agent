import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Coverage } from "../discover/gates.ts";

// The newest readable data/coverage/<date>.json, or undefined when there is none.
export function readLatestCoverage(dataDir: string): Coverage | undefined {
  const dir = join(dataDir, "coverage");
  if (!existsSync(dir)) return undefined;
  for (const f of readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse()) {
    try {
      const c = JSON.parse(readFileSync(join(dir, f), "utf8")) as Coverage;
      if (typeof c.date === "string" && [c.n, c.inCatalog, c.inCatalogNotRejected].every((x) => typeof x === "number")) return c;
    } catch { /* unreadable file: try the next older one */ }
  }
  return undefined;
}
