// One identity and one state per posting, and the candidate's daily page.
// Pure: the CLI gathers the catalog, labels, ledger, H-1B records and held forms,
// and this module decides each posting's state and renders the page.
import type { Job } from "../domain/job.ts";
import type { Policy } from "../profile/schema.ts";
import { applyOrder, eligibility, postedOn, type Eligibility } from "./eligibility.ts";
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
}

// A posting found through a third-party link resolves to its official id through the link check.
const idsOf = (j: Job): string[] => {
  const final = j.link?.finalUrl;
  return final ? [j.key, jobKey(final)] : [j.key];
};

export function postingState(job: Job, e: Eligibility, app: AppEvent | undefined): PostingState {
  if (app?.state === "confirmed" || app?.state === "submitted") return "applied";
  if (app?.state === "unconfirmed") return "unconfirmed";
  // A held application counts only while the posting is still one to apply to.
  if (app?.state === "held") return e.ok ? "held" : "skipped";
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
}

export function postings(i: TodayInput): Posting[] {
  const out: Posting[] = [];
  for (const job of i.jobs) {
    const app = idsOf(job).map((id) => i.apps.get(id)).find(Boolean);
    const e = eligibility({ job, label: i.labels.get(job.key), h1b: i.h1b.get(employerKey(job.company)), policy: i.policy, payFloor: i.payFloor, today: i.today });
    out.push({ job, state: postingState(job, e, app), eligibility: e, app });
  }
  return out;
}

// What a held application is waiting on: one line per required question the rules cannot answer.
export interface Blocker {
  company: string;
  title: string;
  question: string;
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

export function renderToday(i: TodayInput & { posts: Posting[]; blockers: Blocker[]; appliedToday: Posting[]; notes?: string[] }): string {
  const since = new Date(Date.parse(`${i.today}T00:00:00Z`) - i.policy.windowDays * 86400000).toISOString().slice(0, 10);
  const live = i.posts.filter((p) => postedOn(p.job) >= since && ["agent_queue", "yours", "held", "applied", "unconfirmed"].includes(p.state));
  const count = (s: PostingState) => i.posts.filter((p) => p.state === s && postedOn(p.job) >= since).length;
  const L: string[] = [`# 今日 · ${i.today}`, "", `规则来自 \`data/policy.yaml\`：最近 ${i.policy.windowDays} 天发布、有 H-1B 记录、不是纯高级岗。`, ""];
  if (i.notes?.length) L.push(...i.notes.map((n) => `> ${n}`), "");
  L.push(
    "| 已投出 | 未确认 | 卡住 | agent 待投 | 你投 | 待复核 |",
    "|---|---|---|---|---|---|",
    `| ${count("applied")} | ${count("unconfirmed")} | ${count("held")} | ${count("agent_queue")} | ${count("yours")} | ${count("review")} |`,
    "",
  );

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

  L.push(`## 三、可投岗位（最近 ${i.policy.windowDays} 天，按发布时间从新到旧）`, "", "| 发布 | 公司 · 岗位 | 地点 | 状态 | 链接 |", "|---|---|---|---|---|");
  const ordered = applyOrder(live.map((p) => ({ ...p, title: p.job.title, publishedAt: p.job.publishedAt, firstSeen: p.job.firstSeen })), i.policy);
  for (const p of ordered) L.push(`| ${postedOn(p.job) || "—"} | ${cell(p.job.company)} · ${cell(p.job.title)} | ${cell(p.job.location).slice(0, 40)} | ${STATE_LABEL[p.state]} | ${p.job.link?.finalUrl || p.job.url} |`);
  L.push("");

  const why = new Map<string, number>();
  for (const p of i.posts) if (p.state === "skipped" && postedOn(p.job) >= since) for (const r of p.eligibility.reasons) { const k = r.replace(/\(.*\)/, "").replace(/^posted .*/, "超出时间窗口").trim(); why.set(k, (why.get(k) ?? 0) + 1); }
  L.push(`## 四、没投的原因（最近 ${i.policy.windowDays} 天）`, "");
  for (const [k, n] of [...why].sort((a, b) => b[1] - a[1])) L.push(`- ${n} 个：${k}`);
  L.push("");
  return L.join("\n");
}
