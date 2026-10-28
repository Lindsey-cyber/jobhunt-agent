// The triage verifier as an API call, for the VPS. Same contract as the
// in-session auditor: it is given only brief.md and blind.jsonl, never the rule
// verdicts, the report or a worker's summary. Code scores what it returns.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { AuditVerdict, BlindItem } from "../discover/audit.ts";

export const DEFAULT_AUDIT_MODEL = "claude-opus-5-5";
const BATCH = 10;

const Verdicts = z.object({
  verdicts: z.array(z.object({ id: z.string(), fit: z.enum(["yes", "no", "unsure"]), reason: z.string() })),
});

export interface AuditRunResult {
  path: string;
  answered: number;
  missing: string[];
  refused: string[];
}

export async function runAuditor(auditDir: string, model = process.env.JH_AUDIT_MODEL ?? DEFAULT_AUDIT_MODEL, log: (s: string) => void = () => {}): Promise<AuditRunResult> {
  const brief = readFileSync(join(auditDir, "brief.md"), "utf8");
  const items = readFileSync(join(auditDir, "blind.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as BlindItem);
  const client = new Anthropic();
  const out = new Map<string, AuditVerdict>();
  const refused: string[] = [];

  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const ids = new Set(batch.map((b) => b.id));
    // One retry for ids the first answer skipped.
    for (let attempt = 0; attempt < 2; attempt++) {
      const todo = batch.filter((b) => !out.has(b.id));
      if (!todo.length) break;
      const response = await client.messages.parse({
        model,
        max_tokens: 16000,
        output_config: { effort: "high", format: zodOutputFormat(Verdicts) },
        // The brief is the same for every batch, so it is cached.
        system: [{ type: "text", text: brief, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: `Judge each posting below. Return one verdict per id, using exactly these ids: ${todo.map((b) => b.id).join(", ")}.\n\n${todo.map((b) => JSON.stringify(b)).join("\n")}`,
          },
        ],
      });
      if (response.stop_reason === "refusal") {
        refused.push(...todo.map((b) => b.id));
        break;
      }
      for (const v of response.parsed_output?.verdicts ?? []) if (ids.has(v.id) && !out.has(v.id)) out.set(v.id, v);
    }
    log(`audited ${Math.min(i + BATCH, items.length)}/${items.length}`);
  }

  const missing = items.filter((b) => !out.has(b.id)).map((b) => b.id);
  // An item the auditor did not answer is recorded as unsure, never guessed.
  for (const id of missing) out.set(id, { id, fit: "unsure", reason: refused.includes(id) ? "auditor refused this batch" : "auditor returned no verdict" });
  const path = join(auditDir, "verdicts.jsonl");
  if (existsSync(path)) throw new Error(`${path} already exists; an audit dir is judged once`);
  writeFileSync(path, items.map((b) => JSON.stringify(out.get(b.id))).join("\n") + "\n");
  return { path, answered: items.length - missing.length, missing, refused };
}
