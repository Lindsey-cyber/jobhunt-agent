// How close a posting is to her background (data/policy.yaml "fit"): weighted terms from her
// resume, read in the title (x3) and the description (x1, capped), plus H-1B volume. The score
// orders applying (tier A first) and never excludes: C is applied to last (the candidate,
// 2026-11-02: mass-apply, but in order).
import type { Job } from "../domain/job.ts";
import type { Policy } from "../profile/schema.ts";
import type { H1bRecord } from "./h1b.ts";

export interface Fit {
  score: number;
  tier: "A" | "B" | "C";
  hits: string[];
}

const has = (text: string, term: string) => new RegExp(`(^|[^a-z0-9])${term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).test(text);

export function fitOf(job: Pick<Job, "title" | "description">, policy: Policy, h1b?: H1bRecord | undefined): Fit {
  const f = policy.fit;
  const title = job.title.toLowerCase();
  const desc = (job.description ?? "").toLowerCase();
  let score = 0;
  const hits: string[] = [];
  for (const [list, w] of [[f.strong, 3], [f.good, 1], [f.weak, -2]] as const) {
    for (const t of list) {
      const inTitle = has(title, t), inDesc = has(desc, t);
      if (!inTitle && !inDesc) continue;
      score += w * (inTitle ? 3 : 1);
      hits.push(`${w < 0 ? "−" : "+"}${t}${inTitle ? " (title)" : ""}`);
    }
  }
  if ((h1b?.filings ?? 0) >= f.h1bVolume) { score += 2; hits.push(`+H-1B ${h1b!.filings}`); }
  return { score, tier: score >= f.tierA ? "A" : score >= f.tierB ? "B" : "C", hits };
}
