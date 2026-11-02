// One identity and one state per posting, and the candidate's daily page.
// Pure: the CLI gathers the catalog, labels, ledger, H-1B records and held forms,
// and this module decides each posting's state and renders the page.
import type { Job } from "../domain/job.ts";
import type { Policy } from "../profile/schema.ts";
import { applyOrder, eligibility, freshSince, isFresh, postedOn, type Eligibility } from "./eligibility.ts";
import type { H1bRecord } from "./h1b.ts";
import { employerKey } from "./h1b.ts";
import { jobKey } from "./identity.ts";

export interface AppEvent {
  key: string; // ledger key ("greenhouse:job-boards.greenhouse.io/acme/jobs/123")
  state: string; // planned | verified | submitted | confirmed | unconfirmed | held | ...
  at: string;
}

// The posting's own id for a ledger entry: the ledger keys applications by page path,
// the catalog by ATS job id; both resolve to the same jobKey.
export const postingIdOf = (ledgerKey: string): string => jobKey(`https://${ledgerKey.slice(ledgerKey.indexOf(":") + 1)}`);

export function applicationIndex(latest: AppEvent[]): Map<string, AppEvent> {
  const m = new Map<string, AppEvent>();
  for (const e of latest) {
    const id = postingIdOf(e.key);
    const prev = m.get(id);
    if (!prev || prev.at < e.at) m.set(id, e);
  }
  return m;
}

export type PostingState = "applied" | "unconfirmed" | "held" | "agent_queue" | "yours" | "skipped" | "review";

export interface Posting {
  job: Job;
  state: PostingState;
  eligibility: Eligibility;
  app?: AppEvent | undefined;
  blockers?: string[] | undefined;
}

// A posting found through a third-party link resolves to its official id through the link check.
const idsOf = (j: Job): string[] => {
  const final = j.link?.finalUrl;
  return final ? [j.key, jobKey(final)] : [j.key];
};

// blockers: for a held application, the required questions today's rules still cannot answer
// (undefined when unknown). A held application with none left goes back to the agent's queue.
export function postingState(job: Job, e: Eligibility, app: AppEvent | undefined, blockers?: string[]): PostingState {
  if (app?.state === "confirmed" || app?.state === "submitted") return "applied";
  if (app?.state === "unconfirmed") return "unconfirmed";
  // A held application counts only while the posting is still one to apply to.
  if (app?.state === "held") return !e.ok ? "skipped" : blockers?.length === 0 && e.lane === "agent" ? "agent_queue" : "held";
  if (e.ok) return e.lane === "agent" ? "agent_queue" : "yours";
  if (job.triage.verdict === "review" && e.reasons.every((r) => r.startsWith("not a match"))) return "review";
  return "skipped";
}

export interface TodayInput {
  jobs: Iterable<Job>;
  labels: Map<string, "fit" | "not_fit">;
  apps: Map<string, AppEvent>;
  h1b: Map<string, H1bRecord>;
  policy: Policy;
  payFloor?: number | undefined;
  today: string;
  // For a held application: the required questions today's rules cannot answer (read from its last form).
  blockersOf?: ((app: AppEvent) => string[] | undefined) | undefined;
}

export function postings(i: TodayInput): Posting[] {
  const out: Posting[] = [];
  for (const job of i.jobs) {
    const app = idsOf(job).map((id) => i.apps.get(id)).find(Boolean);
    const e = eligibility({ job, label: i.labels.get(job.key), h1b: i.h1b.get(employerKey(job.company)), policy: i.policy, payFloor: i.payFloor, today: i.today });
    const blockers = app?.state === "held" && e.ok ? i.blockersOf?.(app) : undefined;
    out.push({ job, state: postingState(job, e, app, blockers), eligibility: e, app, blockers });
  }
  return out;
}

// The agent's work list, the one apply-approved runs: never-tried postings and held ones
// today's rules now fully answer, on the agent's lane, in apply order (applyOrder).
export function agentQueue(posts: Posting[], policy: Policy, today: string, tierOf: (p: Posting) => "A" | "B" | "C"): Posting[] {
  const q = posts.filter((p) => p.state === "agent_queue");
  const keyed = q.map((p) => ({ ...p, title: p.job.title, publishedAt: p.job.publishedAt, firstSeen: p.job.firstSeen }));
  const order = (xs: typeof keyed) => applyOrder(xs, policy, today, (x) => tierOf(x));
  return [...order(keyed.filter((p) => !p.app)), ...order(keyed.filter((p) => p.app))];
}

// What a held application is waiting on: one line per required question the rules cannot answer.
export interface Blocker {
  company: string;
  title: string;
  question: string;
}

export function atsOf(j: Job): string {
  const k = j.key.split(":")[0]!;
  if (["greenhouse", "workday", "ashby", "lever"].includes(k)) return k;
  const u = j.link?.finalUrl || j.url;
  return /myworkdayjobs/.test(u) ? "workday" : /greenhouse|gh_jid/.test(u) ? "greenhouse" : /ashbyhq/.test(u) ? "ashby" : /lever\.co/.test(u) ? "lever" : "company site";
}

// Who acts next on a live posting, for the overview table.
export function whoOf(p: Posting): string {
  if (p.state === "agent_queue") return "agent 待投";
  if (p.state === "held") return p.eligibility.lane === "agent" ? "agent 已填、等你答题" : `你投 · ${atsOf(p.job)}（已开始、等你答题）`;
  return `你投 · ${atsOf(p.job)}`;
}

const STATE_LABEL: Record<PostingState, string> = {
  applied: "已投出",
  unconfirmed: "已提交，未确认",
  held: "卡住",
  agent_queue: "agent 待投",
  yours: "你投",
  skipped: "不投",
  review: "待复核",
};

const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ").trim();

export function renderToday(i: TodayInput & { posts: Posting[]; blockers: Blocker[]; appliedToday: Posting[]; tierOf: (p: Posting) => "A" | "B" | "C"; queueSize: number; pending?: string | undefined; notes?: string[] }): string {
  const since = freshSince(i.policy, i.today);
  const fresh = (p: Posting) => isFresh(p.job, i.policy, i.today);
  const open = i.posts.filter((p) => ["agent_queue", "yours", "held"].includes(p.state));
  const count = (s: PostingState) => i.posts.filter((p) => p.state === s).length;
  // Self-checks: the page refuses to print numbers that do not reconcile.
  const states: PostingState[] = ["applied", "unconfirmed", "held", "agent_queue", "yours", "review", "skipped"];
  if (states.reduce((n, s) => n + count(s), 0) !== i.posts.length) throw new Error("today: posting states do not add up to the postings");
  if (count("agent_queue") !== i.queueSize) throw new Error(`today: ${count("agent_queue")} agent_queue postings but apply-approved's queue has ${i.queueSize}`);
  const openFresh = open.filter(fresh).length;
  const L: string[] = [`# 今日 · ${i.today}`, "", `规则来自 \`data/policy.yaml\`：有 H-1B 记录、不是纯高级岗。最近 ${i.policy.freshDays} 天发布的（${since} 起）先投，更早的照样投、排在后面。下面的数字都经过自检：各状态之和等于总数，agent 待投与投递命令的队列一致。`, ""];
  if (i.notes?.length) L.push(...i.notes.map((n) => `> ${n}`), "");
  L.push(`**库里全部 ${i.posts.length} 个岗位**：已投出 ${count("applied")}，已提交未确认 ${count("unconfirmed")}，还没投出的 ${open.length}（最近 ${i.policy.freshDays} 天 ${openFresh}，更早 ${open.length - openFresh}），待复核 ${count("review")}，不投 ${count("skipped")}。`, "");
  const who = new Map<string, Record<"A" | "B" | "C", number>>();
  for (const p of open) { const k = whoOf(p); const r = who.get(k) ?? { A: 0, B: 0, C: 0 }; r[i.tierOf(p)]++; who.set(k, r); }
  const order = (k: string) => (k.startsWith("agent 待投") ? 0 : k.startsWith("agent 已填") ? 1 : 2);
  L.push("## 还没投出的岗位：谁来投 × 档位", "", "| 谁来投 | A | B | C | 合计 |", "|---|---|---|---|---|");
  let tA = 0, tB = 0, tC = 0;
  for (const [k, r] of [...who].sort((a, b) => order(a[0]) - order(b[0]) || (b[1].A + b[1].B + b[1].C) - (a[1].A + a[1].B + a[1].C))) { L.push(`| ${k} | ${r.A} | ${r.B} | ${r.C} | ${r.A + r.B + r.C} |`); tA += r.A; tB += r.B; tC += r.C; }
  L.push(`| **合计** | ${tA} | ${tB} | ${tC} | ${tA + tB + tC} |`, "");
  if (tA + tB + tC !== open.length) throw new Error("today: the overview table does not add up to the open postings");
  if (i.pending?.trim()) L.push("## 等你决定的事", "", i.pending.trim(), "");

  L.push(`## 一、今天投出的（${i.appliedToday.length}）`, "");
  for (const p of i.appliedToday) L.push(`- ${cell(p.job.company)} · ${cell(p.job.title)}${p.state === "unconfirmed" ? "（未确认）" : ""}`);
  L.push("");

  // To-dos ranked by how many applications each unblocks.
  const byQ = new Map<string, Blocker[]>();
  for (const b of i.blockers) {
    const essay = /^why\b|\bwhy (do|would|are) you\b|\bwhy (this|us|join)\b|tell us|describe|what (makes|excites|interests)|exceptional work|how do you use/i.test(b.question);
    const k = essay ? `为 ${b.company} 写一段：${b.question}` : b.question;
    byQ.set(k, [...(byQ.get(k) ?? []), b]);
  }
  const todos = [...byQ].sort((a, b) => b[1].length - a[1].length);
  L.push(`## 二、你的待办（按能放行的申请数排序，共 ${todos.length} 项${todos.length > 30 ? "，只列前 30 项" : ""}）`, "");
  for (const [q, bs] of todos.slice(0, 30)) L.push(`- **放行 ${bs.length} 份**：${cell(q).slice(0, 160)}（${[...new Set(bs.map((b) => `${b.company} · ${b.title}`))].map(cell).slice(0, 4).join("；")}${bs.length > 4 ? " 等" : ""}）`);
  L.push("");

  L.push(`## 三、还没投出的岗位（最近 ${i.policy.freshDays} 天的在前；各自档位优先，同档按发布时间从新到旧）`, "", "| 档 | 发布 | 公司 · 岗位 | 地点 | 谁来投 | 链接 |", "|---|---|---|---|---|---|");
  const ordered = applyOrder(open.map((p) => ({ ...p, title: p.job.title, publishedAt: p.job.publishedAt, firstSeen: p.job.firstSeen })), i.policy, i.today, (p) => i.tierOf(p));
  for (const p of ordered) L.push(`| ${i.tierOf(p)} | ${postedOn(p.job) || "—"} | ${cell(p.job.company)} · ${cell(p.job.title)} | ${cell(p.job.location).slice(0, 40)} | ${whoOf(p)} | ${p.job.link?.finalUrl || p.job.url} |`);
  L.push("");

  const why = new Map<string, number>();
  for (const p of i.posts) if (p.state === "skipped" && fresh(p)) for (const r of p.eligibility.reasons) { const k = r.replace(/\(.*\)/, "").trim(); why.set(k, (why.get(k) ?? 0) + 1); }
  L.push(`## 四、没投的原因（最近 ${i.policy.freshDays} 天发布的）`, "");
  for (const [k, n] of [...why].sort((a, b) => b[1] - a[1])) L.push(`- ${n} 个：${k}`);
  L.push("");
  return L.join("\n");
}
