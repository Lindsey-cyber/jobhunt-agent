// The model triage worker: judges the postings the rules leave at "review" with
// the auditor's brief (same candidate facts, same yes/no/unsure contract), in
// batches, and folds the verdicts into the catalog. Verdicts are recorded in
// data/model-triage.jsonl; a posting is judged again only when its text changes.
import type { Job } from "../domain/job.ts";
import { auditorBrief, type BlindItem } from "../discover/audit.ts";
import { retriage } from "../discover/merge.ts";
import { needsModel, basisOf, type ModelVerdict } from "../discover/modeltriage.ts";
import type { UserData } from "../profile/load.ts";
import { candidateFacts } from "../run/discover.ts";
import { readCatalog, writeCatalog } from "../store/catalog.ts";
import { appendModelVerdicts, readModelVerdicts } from "../store/modelverdicts.ts";
import { paths } from "../store/state.ts";
import { DEFAULT_MODELS, auditProvider, judgeItems } from "./auditor.ts";

const BATCH = 10;

// Many of these postings come from alert emails with a title and no description.
const NO_DESCRIPTION = `

Some postings have no description, only a title (they come from job-alert emails). Judge those from the title alone only when it settles the question: "yes" when the title is clearly a target role at new-grad / entry level (for example "Machine Learning Engineer, New Grad", "Associate Data Scientist", "AI Engineer I"); "no" when it is clearly senior (Senior, Staff, Principal, Lead, Manager, Director, II/III and above in a ladder that starts at I) or clearly not a target role; otherwise "unsure".`;

const item = (j: Job): BlindItem => ({
  id: j.key,
  company: j.company,
  title: j.title,
  location: j.location,
  url: j.url,
  officialPosting: j.official,
  description: j.description.slice(0, 6000),
  sourceNotes: j.sources.map((s) => s.channel).slice(0, 4),
});

export interface ModelTriageResult {
  judged: number;
  yes: number;
  no: number;
  unsure: number;
  model: string;
}

export async function modelTriage(user: UserData, opts: { limit?: number; model?: string; log?: (s: string) => void } = {}): Promise<ModelTriageResult> {
  const log = opts.log ?? (() => {});
  const provider = auditProvider();
  const model = opts.model ?? process.env.JH_TRIAGE_MODEL ?? DEFAULT_MODELS[provider];
  const catalogPath = paths(user.dir).catalog;
  const catalog = readCatalog(catalogPath);
  const verdicts = readModelVerdicts(user.dir);
  // Newest first: what the candidate can still apply to.
  const todo = [...catalog.values()].filter((j) => needsModel(j, verdicts.get(j.key))).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)).slice(0, opts.limit ?? 300);
  const brief = auditorBrief(user.profile) + NO_DESCRIPTION;
  const at = new Date().toISOString();
  const fresh: ModelVerdict[] = [];
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const r = await judgeItems(provider, model, brief, batch.map(item)).catch((e: Error) => {
      log(`batch ${i / BATCH + 1} failed: ${e.message}`);
      return { verdicts: [], refused: false };
    });
    const byId = new Map(r.verdicts.map((v) => [v.id, v]));
    for (const j of batch) {
      const v = byId.get(j.key);
      if (v) fresh.push({ key: j.key, fit: v.fit, reason: v.reason, basis: basisOf(j), model, at });
    }
    log(`model triage ${Math.min(i + BATCH, todo.length)}/${todo.length}`);
  }
  appendModelVerdicts(user.dir, fresh);
  for (const v of fresh) verdicts.set(v.key, v);
  writeCatalog(catalogPath, retriage(catalog.values(), candidateFacts(user.profile), user.search.excludeCompanies, verdicts));
  const n = (f: ModelVerdict["fit"]) => fresh.filter((v) => v.fit === f).length;
  return { judged: fresh.length, yes: n("yes"), no: n("no"), unsure: n("unsure"), model };
}
