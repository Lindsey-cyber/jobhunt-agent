// The triage verifier as an API call, for the VPS. Same contract as the
// in-session auditor: it is given only brief.md and blind.jsonl, never the rule
// verdicts, the report or a worker's summary. Code scores what it returns.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { AuditVerdict, BlindItem } from "../discover/audit.ts";

export type AuditProvider = "anthropic" | "openai";
export const DEFAULT_MODELS: Record<AuditProvider, string> = { anthropic: "claude-opus-5-5", openai: "gpt-5.5" };
export const DEFAULT_AUDIT_MODEL = DEFAULT_MODELS.anthropic;

// JH_AUDIT_PROVIDER picks the provider; otherwise whichever key is set, Anthropic first.
export function auditProvider(): AuditProvider {
  const p = process.env.JH_AUDIT_PROVIDER;
  if (p === "anthropic" || p === "openai") return p;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  throw new Error("no auditor credentials: set ANTHROPIC_API_KEY or OPENAI_API_KEY");
}
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

export type Batch = { verdicts: AuditVerdict[]; refused: boolean };

const USER_PROMPT = (todo: BlindItem[]) =>
  `Judge each posting below. Return one verdict per id, using exactly these ids: ${todo.map((b) => b.id).join(", ")}.\n\n${todo.map((b) => JSON.stringify(b)).join("\n")}`;

async function judgeAnthropic(client: Anthropic, model: string, brief: string, todo: BlindItem[]): Promise<Batch> {
  const response = await client.messages.parse({
    model,
    max_tokens: 16000,
    output_config: { effort: "high", format: zodOutputFormat(Verdicts) },
    // The brief is the same for every batch, so it is cached.
    system: [{ type: "text", text: brief, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: USER_PROMPT(todo) }],
  });
  if (response.stop_reason === "refusal") return { verdicts: [], refused: true };
  return { verdicts: response.parsed_output?.verdicts ?? [], refused: false };
}

// OpenAI Chat Completions with a strict JSON schema, through plain fetch.
async function judgeOpenAI(model: string, brief: string, todo: BlindItem[]): Promise<Batch> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model,
      reasoning_effort: "high",
      messages: [
        { role: "developer", content: brief },
        { role: "user", content: USER_PROMPT(todo) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "verdicts",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["verdicts"],
            properties: {
              verdicts: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "fit", "reason"],
                  properties: { id: { type: "string" }, fit: { type: "string", enum: ["yes", "no", "unsure"] }, reason: { type: "string" } },
                },
              },
            },
          },
        },
      },
    }),
    signal: AbortSignal.timeout(600_000),
  });
  const body = (await res.json()) as { error?: { message: string }; choices?: { message: { content: string | null; refusal?: string | null } }[] };
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${body.error?.message ?? "unknown error"}`);
  const msg = body.choices?.[0]?.message;
  if (!msg || msg.refusal || !msg.content) return { verdicts: [], refused: Boolean(msg?.refusal) };
  const parsed = Verdicts.safeParse(JSON.parse(msg.content));
  return { verdicts: parsed.success ? parsed.data.verdicts : [], refused: false };
}

// One batch judged by the chosen provider; shared with the model triage worker.
// A slow answer can outlast the HTTP client's header timeout: retry once.
export async function judgeItems(provider: AuditProvider, model: string, brief: string, items: BlindItem[], client?: Anthropic): Promise<Batch> {
  const once = () => (provider === "anthropic" ? judgeAnthropic(client ?? new Anthropic(), model, brief, items) : judgeOpenAI(model, brief, items));
  return once().catch(once);
}

export async function runAuditor(auditDir: string, model?: string, log: (s: string) => void = () => {}, provider: AuditProvider = auditProvider()): Promise<AuditRunResult & { provider: AuditProvider; model: string }> {
  const m = model ?? process.env.JH_AUDIT_MODEL ?? DEFAULT_MODELS[provider];
  const brief = readFileSync(join(auditDir, "brief.md"), "utf8");
  const items = readFileSync(join(auditDir, "blind.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as BlindItem);
  const client = provider === "anthropic" ? new Anthropic() : undefined;
  const out = new Map<string, AuditVerdict>();
  const refused: string[] = [];

  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const ids = new Set(batch.map((b) => b.id));
    // One retry for ids the first answer skipped.
    for (let attempt = 0; attempt < 2; attempt++) {
      const todo = batch.filter((b) => !out.has(b.id));
      if (!todo.length) break;
      const r = client ? await judgeAnthropic(client, m, brief, todo) : await judgeOpenAI(m, brief, todo);
      if (r.refused) {
        refused.push(...todo.map((b) => b.id));
        break;
      }
      for (const v of r.verdicts) if (ids.has(v.id) && !out.has(v.id)) out.set(v.id, v);
    }
    log(`audited ${Math.min(i + BATCH, items.length)}/${items.length}`);
  }

  const missing = items.filter((b) => !out.has(b.id)).map((b) => b.id);
  // An item the auditor did not answer is recorded as unsure, never guessed.
  for (const id of missing) out.set(id, { id, fit: "unsure", reason: refused.includes(id) ? "auditor refused this batch" : "auditor returned no verdict" });
  const path = join(auditDir, "verdicts.jsonl");
  if (existsSync(path)) throw new Error(`${path} already exists; an audit dir is judged once`);
  writeFileSync(path, items.map((b) => JSON.stringify(out.get(b.id))).join("\n") + "\n");
  return { path, answered: items.length - missing.length, missing, refused, provider, model: m };
}
