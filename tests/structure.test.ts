import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? files(join(dir, d.name)) : d.name.endsWith(".ts") ? [join(dir, d.name)] : [],
  );
const source = (f: string) => readFileSync(join(ROOT, f), "utf8");

describe("structure", () => {
  it("keeps the deciding code pure: plan, gate, verify and discover never touch a browser, the disk or the network", () => {
    const offenders = ["src/plan", "src/gate", "src/verify", "src/discover"]
      .flatMap(files)
      // Type-only imports are erased at runtime, so they may name IO modules.
      .filter((f) => /from "(playwright|node:fs|node:child_process|node:http|node:https)"|\bfetch\(|from "\.\.\/(sources|run|store|org)\//.test(source(f).replace(/^import type .*$/gm, "")));
    expect(offenders).toEqual([]);
  });

  it("has exactly one place that clicks submit, and it records the submission first", () => {
    const callers = files("src").filter((f) => /\.submit\(/.test(source(f)));
    expect(callers).toEqual(["src/run/apply.ts"]);
    const run = source("src/run/apply.ts");
    expect(run.indexOf('ledger.transition(key, "submitted"')).toBeGreaterThan(-1);
    expect(run.indexOf('ledger.transition(key, "submitted"')).toBeLessThan(run.indexOf("adapter.submit("));
    expect(run.indexOf('decision.decision === "hold"')).toBeLessThan(run.indexOf("adapter.submit("));
  });

  it("reads the candidate's exclusion and H-1B decisions only in eligibility.ts, the schema and the loader", () => {
    const allowed = new Set(["src/discover/eligibility.ts", "src/profile/schema.ts", "src/profile/load.ts"]);
    const re = /\b(excludeCompanies|excludeTitles|h1bRequiredSince)\b/;
    const offenders = files("src").filter((f) => !allowed.has(f) && re.test(source(f)));
    // Elsewhere the values are only passed through (retriage's and discover's exclude argument, the jh h1b lookup year); nothing decides on them.
    const passThrough = /retriage\(|exclude: [\w.]+\.excludeCompanies|const since = u\.search\.h1bRequiredSince|no h1bRequiredSince/;
    const deciding = offenders.flatMap((f) => source(f).split("\n").filter((l) => re.test(l) && !passThrough.test(l)).map((l) => `${f}: ${l.trim()}`));
    expect(deciding).toEqual([]);
  });

  it("keeps discovery read-only and free of application code: sources and org never import src/ats or playwright, and gmail.ts calls no write endpoint", () => {
    const offenders = ["src/sources", "src/org"].flatMap(files).filter((f) => /from "(playwright|\.\.\/ats\/[^"]*)"/.test(source(f)));
    expect(offenders).toEqual([]);
    expect(source("src/sources/gmail.ts")).not.toMatch(/\/(send|modify|trash|untrash|drafts|batchModify|batchDelete)\b|\.(send|modify|trash|drafts)\(/);
  });

  it("never waits for a typed answer: no readline or prompt under run, org or cli", () => {
    const offenders = [...files("src/run"), ...files("src/org"), "src/cli.ts"].filter((f) => /node:readline|\breadline\b|\bprompt\(|process\.stdin/.test(source(f).replace(/\/\/.*$/gm, "")));
    expect(offenders).toEqual([]);
  });

  it("registers every adapter and gives each one a feature map", () => {
    const adapters = readdirSync(join(ROOT, "src/ats"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    const registry = source("src/ats/registry.ts");
    for (const a of adapters) {
      expect(registry, `${a} missing from registry`).toContain(`./${a}/adapter.ts`);
      expect(() => source(`.claude/skills/verify-apply/features/${a}.md`), `${a} has no feature map`).not.toThrow();
    }
  });
});
