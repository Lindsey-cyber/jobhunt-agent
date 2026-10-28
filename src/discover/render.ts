// Renders the discovery report (Markdown, for the candidate) and the dashboard
// (one self-contained HTML page). Pure: data in, strings out.
import type { Job } from "../domain/job.ts";
import type { SourceOutcome } from "../sources/fetch.ts";
import type { AuditScore } from "./audit.ts";
import type { ChannelMetrics } from "./metrics.ts";
import { priority, publishedWithin } from "./metrics.ts";
import type { OutreachEntry } from "./outreach.ts";
import type { StageState } from "./stagetrust.ts";

export interface ReportData {
  generatedAt: string;
  runStartedAt: string;
  runFinishedAt: string;
  runDir: string;
  trust: string;
  jobs: Job[];
  sightings: number;
  channels: ChannelMetrics[];
  outcomes: SourceOutcome[];
  skipped: { name: string; reason: string }[];
  audit?: { score: AuditScore; sampleSize: number; auditor: string; at: string };
  stage: StageState;
  outreach: OutreachEntry[];
  inboxMessages: number;
  pending: { kind: string; count: number }[];
}

const CHANNEL_ZH: Record<string, string> = {
  official_greenhouse: "官方 Greenhouse",
  official_lever: "官方 Lever",
  official_ashby: "官方 Ashby",
  official_workday: "官方 Workday",
  github_newgrad: "GitHub New Grad 列表",
  gmail_linkedin: "Gmail · LinkedIn 提醒",
  gmail_glassdoor: "Gmail · Glassdoor 提醒",
  gmail_handshake: "Gmail · Handshake 提醒",
  gmail_indeed: "Gmail · Indeed 提醒",
  hn_hiring: "HN Who is hiring",
};

const pct = (x: number | null | undefined, d = 1) => (x == null ? "—" : `${(x * 100).toFixed(d)}%`);
const sh = (iso: string) => (iso ? iso.slice(0, 16).replace("T", " ") + " UTC" : "未知");
const md = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

// 95% Wilson interval, so small audit samples are not over-read.
export function wilson(bad: number, n: number): [number, number] | null {
  if (n === 0) return null;
  const z = 1.96, p = bad / n;
  const den = 1 + (z * z) / n;
  const mid = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}

export function summarize(d: ReportData) {
  const seen = d.jobs.filter((j) => j.lastSeen >= d.runStartedAt);
  const leads = seen.filter((j) => j.key.startsWith("lead:"));
  const postings = seen.filter((j) => !j.key.startsWith("lead:"));
  const by = (v: string) => postings.filter((j) => j.triage.verdict === v);
  const matches = by("match").sort(priority);
  const checked = matches.filter((j) => j.link);
  const link = (s: string) => checked.filter((j) => j.link!.status === s).length;
  return {
    seen,
    postings,
    leads,
    matches,
    review: by("review"),
    reject: by("reject"),
    officialMatches: matches.filter((j) => j.official),
    linkValid: link("valid"),
    linkInvalid: link("invalid"),
    linkBlocked: link("blocked"),
    linkUnverified: link("unverified"),
    linkChecked: checked.length,
    m7: matches.filter((j) => publishedWithin(j, 7, d.runStartedAt)).length,
    m30: matches.filter((j) => publishedWithin(j, 30, d.runStartedAt)).length,
    mUnknown: matches.filter((j) => !j.publishedAt).length,
    all7: postings.filter((j) => publishedWithin(j, 7, d.runStartedAt)).length,
    all30: postings.filter((j) => publishedWithin(j, 30, d.runStartedAt)).length,
    companies: new Set(postings.map((j) => j.company.toLowerCase())).size,
    matchCompanies: new Set(matches.map((j) => j.company.toLowerCase())).size,
    largeMatches: matches.filter((j) => j.size === "medium_large").length,
  };
}

export function reportMarkdown(d: ReportData): string {
  const s = summarize(d);
  const L: string[] = [];
  const ok = d.outcomes.filter((o) => o.ok);
  const failed = d.outcomes.filter((o) => !o.ok);
  L.push(`# 多渠道职位发现报告 · ${d.runStartedAt.slice(0, 10)}`, "");
  L.push(`运行 ${sh(d.runStartedAt)} → ${sh(d.runFinishedAt)}，报告生成 ${sh(d.generatedAt)}。信任等级 \`${d.trust}\`：**本轮只发现和筛选，没有打开任何申请表，提交 0 份。**`, "");
  L.push("| 项目 | 数量 |", "| --- | ---: |");
  const rows: [string, string | number][] = [
    ["原始发现记录（sightings，含跨渠道重复）", d.sightings],
    ["去重后岗位（按 ATS Job ID / 官方链接）", s.postings.length],
    ["合并掉的重复记录", d.sightings - s.postings.length - s.leads.length],
    ["无链接线索（Handshake 提醒等，不参与合并）", s.leads.length],
    ["规则匹配 match", `${s.matches.length}（官方页 ${s.officialMatches.length}，仅第三方 ${s.matches.length - s.officialMatches.length}）`],
    ["待核实 review / 排除 reject", `${s.review.length} / ${s.reject.length}`],
    ["匹配岗位链接核验：有效 / 失效 / 受限 / 未能核验", `${s.linkValid} / ${s.linkInvalid} / ${s.linkBlocked} / ${s.linkUnverified}（共核验 ${s.linkChecked}）`],
    ["匹配岗位中官方发布于近 7 / 30 天", `${s.m7} / ${s.m30}（${s.mUnknown} 个无官方发布日期）`],
    ["全部岗位中官方发布于近 7 / 30 天", `${s.all7} / ${s.all30}`],
    ["观察到的公司 / 有匹配的公司", `${s.companies} / ${s.matchCompanies}`],
    ["匹配岗位中属于名单内中大型公司", `${s.largeMatches} / ${s.matches.length}`],
    ["来源成功 / 失败或跳过", `${ok.length} / ${failed.length + d.skipped.length}`],
  ];
  for (const [k, v] of rows) L.push(`| ${k} | ${v} |`);
  L.push("");
  L.push("“近 7/30 天”只用雇主 ATS 给出的发布时间（Greenhouse `first_published`、Lever `createdAt`、Ashby `publishedAt`）。Workday 只给 start date，GitHub 列表和邮件只有转载/收件时间，这些都不当成发布时间。本仓库从今天开始记录每个来源的首次发现时间，下次运行起才能统计“我们新发现”的岗位。", "");

  L.push("## 渠道贡献", "");
  L.push("| 渠道 | 发现记录 | 岗位数 | 独有 | 与其他渠道共有 | 渠道内重复率 | 匹配 | 独有匹配 | 官方近7/30天（全部） | 匹配近7/30天 |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const c of d.channels) {
    L.push(`| ${CHANNEL_ZH[c.channel] ?? c.channel} | ${c.sightings} | ${c.postings} | ${c.exclusive} | ${c.shared} | ${pct(c.duplicateRate)} | ${c.matches} | ${c.exclusiveMatches} | ${c.published7d}/${c.published30d} | ${c.matchesPublished7d}/${c.matchesPublished30d} |`);
  }
  L.push("", "“独有”= 本轮只有这个渠道报告了这个 Job ID。一个岗位可被多个渠道报告，各列不能相加。第三方渠道（GitHub、邮件、HN）的“官方近7/30天”来自同一岗位的官方记录，没有官方记录就算未知。", "");

  L.push("## 来源覆盖", "");
  const wl = ok.filter((o) => !o.discoveredFrom && o.channel.startsWith("official_"));
  const ex = d.outcomes.filter((o) => o.discoveredFrom);
  const kinds = ["official_greenhouse", "official_lever", "official_ashby", "official_workday"];
  L.push(`- 长期监控名单（\`config/watchlist.yaml\`）：${kinds.map((k) => `${CHANNEL_ZH[k]} ${wl.filter((o) => o.channel === k).length} 家`).join("，")}，共 ${wl.reduce((a, o) => a + o.count, 0)} 个在招岗位。Workday 没有全量接口，每家用固定关键词做有界搜索，召回不完整。`);
  L.push(`- 从第三方列表顺藤摸瓜抓取的官方 Board：${ex.length} 个（成功 ${ex.filter((o) => o.ok).length}），让官方要求而不是转载内容决定筛选。`);
  for (const o of d.outcomes.filter((x) => x.channel === "github_newgrad" || x.channel === "hn_hiring")) L.push(`- ${o.name}：${o.ok ? `${o.count} 条` : `失败：${o.error}`}${o.note ? `（${o.note}）` : ""}`);
  L.push(`- Gmail：读取近 30 天 ${d.inboxMessages} 封 LinkedIn/Glassdoor/Handshake/Indeed 提醒邮件（Gmail API，只读授权）。`);
  for (const o of d.outcomes.filter((x) => x.channel.startsWith("gmail_"))) L.push(`  - ${o.name}：${o.ok ? `${o.count} 条` : o.error}${o.note ? `（${o.note}）` : ""}`);
  if (failed.length) {
    L.push("", "失败的来源：", "");
    for (const o of failed) L.push(`- ${o.name}（${CHANNEL_ZH[o.channel] ?? o.channel}）：${o.error}`);
  }
  L.push("", "跳过的来源（没有授权接口，不模拟登录、不抓取受限站点）：", "");
  for (const k of d.skipped) L.push(`- ${k.name}：${k.reason}`);
  L.push("");

  L.push("## 筛选规则", "");
  L.push("New Grad / 0–2 年 + AI/ML、研究、数据工程类岗位。签证：职位没写就不过滤；官方页面明确写了不担保才排除，第三方转载的“不担保”只进待核实。需要美国公民身份或安全许可的岗位排除（候选人不是美国公民）。要求 PhD 的岗位排除（候选人最高学历为硕士）；“MS/PhD”不排除。", "");
  const counts = new Map<string, { verdict: string; n: number; reason: string }>();
  for (const j of s.postings) {
    const c = counts.get(j.triage.rule) ?? { verdict: j.triage.verdict, n: 0, reason: j.triage.reason.replace(/[:：].*$/, "").replace(/"[^"]*"/g, "…") };
    c.n++;
    counts.set(j.triage.rule, c);
  }
  L.push("| 结果 | 规则 | 数量 | 说明 |", "| --- | --- | ---: | --- |");
  for (const [rule, c] of [...counts].sort((a, b) => b[1].n - a[1].n)) L.push(`| ${c.verdict} | \`${rule}\` | ${c.n} | ${md(c.reason.slice(0, 90))} |`);
  L.push("");

  L.push("## 筛选审计（独立审核 agent 盲评）", "");
  if (!d.audit) {
    L.push("本轮尚未完成审计。", "");
  } else {
    const a = d.audit.score;
    const ci = (rate: number | null, n: number) => {
      if (rate == null) return "—";
      const w = wilson(Math.round(rate * n), n)!;
      return `${pct(rate)}（95% 区间 ${pct(w[0], 0)}–${pct(w[1], 0)}，n=${n}）`;
    };
    L.push(`抽样 ${d.audit.sampleSize} 个岗位，分层：规则匹配、全部排除中随机、“标题像 AI/ML 却被排除”的边缘排除、待核实。审核者：${d.audit.auditor}。它只看岗位原文和候选人事实，看不到规则结论，也看不到工人的说法；评分由代码对照隐藏的答案键完成。`, "");
    L.push("| 指标 | 结果 |", "| --- | --- |");
    L.push(`| 误筛率（匹配里审核者认为不合适） | ${ci(a.falseMatchRate, a.matchJudged)} |`);
    L.push(`| 漏筛率（随机排除里审核者认为合适） | ${ci(a.missRate, a.rejectJudged)} |`);
    L.push(`| 边缘排除中被认为合适 | ${ci(a.nearMissRate, a.nearJudged)} |`);
    L.push(`| 待核实 → 审核者：合适 / 不合适 | ${a.reviewFit} / ${a.reviewNotFit} |`);
    L.push(`| 审核者“无法判断” | ${a.unsure} |`, "");
    if (d.stage.audits.length > 1) {
      L.push("历次审计（每轮都是新的盲样本、新的审核者实例）：", "", "| 时间 | 误筛率 | n | 漏筛率 | n |", "| --- | ---: | ---: | ---: | ---: |");
      for (const r of d.stage.audits) L.push(`| ${sh(r.at)} | ${pct(r.falseMatchRate)} | ${r.matchJudged} | ${pct(r.missRate)} | ${r.rejectJudged} |`);
      L.push("");
    }
    L.push(`筛选环节信任等级：\`${d.stage.level}\`（${d.stage.reason}）。超过 10% 自动降回“等我确认”；连续 3 次审计误筛和漏筛都 ≤5% 才会建议升级，由你决定。`, "");
    if (a.disagreements.length) {
      L.push("分歧（已进每日清单，你的判断会存成评测集）：", "");
      L.push("| 规则结论 | 规则 | 审核者 | 理由 | 岗位 |", "| --- | --- | --- | --- | --- |");
      const byKey = new Map(d.jobs.map((j) => [j.key as string, j]));
      for (const x of a.disagreements) {
        const j = byKey.get(x.key);
        L.push(`| ${x.verdict} | \`${x.rule}\` | ${x.fit} | ${md(x.reason.slice(0, 160))} | ${j ? `[${md(j.company)} · ${md(j.title)}](${j.url})` : x.key} |`);
      }
      L.push("");
    }
  }

  L.push("## 链接抽样核验", "");
  L.push(`对本轮全部匹配岗位（官方优先）逐个请求岗位页：${s.linkChecked} 个中有效 ${s.linkValid}、失效 ${s.linkInvalid}、站点拒绝自动访问 ${s.linkBlocked}、未能核验 ${s.linkUnverified}。“有效”= HTTP 200、没有跳回 Board 首页、页面没有“职位已关闭”字样；官方 API 本轮仍列出该岗位是更强的在招证据。页面有效不等于申请表能提交成功。`, "");
  const bad = s.matches.filter((j) => j.link && j.link.status !== "valid").slice(0, 25);
  if (bad.length) {
    L.push("| 状态 | 岗位 | 说明 |", "| --- | --- | --- |");
    for (const j of bad) L.push(`| ${j.link!.status} | [${md(j.company)} · ${md(j.title)}](${j.url}) | ${md(j.link!.note)} |`);
    L.push("");
  }

  L.push("## 匹配岗位（前 80，官方页优先）", "");
  L.push("完整列表见 `matches.csv`（含全部来源、各来源日期类型、首次发现时间、链接核验）。", "");
  L.push("| 公司 | 岗位 | 地点 | 官方发布 | 来源 | 链接 |", "| --- | --- | --- | --- | --- | --- |");
  for (const j of s.matches.slice(0, 80)) {
    const ch = [...new Set(j.sources.map((x) => (CHANNEL_ZH[x.channel] ?? x.channel).replace(/^官方 /, "官方·")))].join("、");
    L.push(`| ${md(j.company)} | [${md(j.title)}](${j.url}) | ${md(j.location.slice(0, 60))} | ${j.publishedAt ? j.publishedAt.slice(0, 10) : "未知"} | ${ch} | ${j.link?.status ?? "未核验"} |`);
  }
  L.push("");

  L.push("## 小公司 Outreach 队列", "");
  const withContact = d.outreach.filter((o) => o.publicContacts.length);
  L.push(`${d.outreach.length} 家公司（官方 Board 在招 ≤30 个岗位作为规模代理，或在 HN Who is hiring 发帖）。其中 ${withContact.length} 家在公开招聘帖里写了联系邮箱；没有一个联系人是猜的或从别处查的。负责人姓名未核实一律留空。每家附一份草稿，经历部分留空待你填写，**没有发送任何邮件或私信**。详见 \`outreach.json\` / \`outreach.csv\`。`, "");

  L.push("## 每日清单（`jh pending`）", "");
  L.push(d.pending.length ? d.pending.map((p) => `- ${p.kind}：${p.count}`).join("\n") : "- 无", "");
  L.push("批准或驳回用 `jh label <清单 id> fit|not_fit`，你的每个决定都存进评测集（`data/labels/triage.jsonl`），以后改规则先在上面跑分。", "");

  L.push("## 局限", "");
  L.push("- 规则只看文本。审计给出的是抽样估计，样本量见上表的区间；没有你的标签前，无法算出真实的误筛/漏筛。");
  L.push("- Workday 是关键词搜索，不是全量；LinkedIn/Indeed/Glassdoor/Handshake 只能通过提醒邮件看到，覆盖取决于你订阅的提醒。");
  L.push("- Handshake 提醒邮件正文没有岗位链接，只能作为线索列出，不与其他来源合并（不按公司+职位名合并）。");
  L.push("- 公司规模是名单分组或在招岗位数代理，不是审计过的员工数。");
  L.push("- 匹配不等于你个人符合全部条件（毕业时间、具体技能等），申请前还要看原文。", "");
  return L.join("\n");
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function dashboardHtml(d: ReportData): string {
  const s = summarize(d);
  const rows = [...s.matches, ...s.review.sort(priority), ...s.reject.filter((j) => j.triage.rule !== "role.out_of_scope" && j.triage.rule !== "source.closed").sort(priority).slice(0, 1500)].map((j) => ({
    k: j.key,
    c: j.company,
    t: j.title,
    l: j.location.slice(0, 90),
    v: j.triage.verdict,
    r: j.triage.rule,
    why: j.triage.reason.slice(0, 220),
    u: j.url,
    o: j.official,
    p: j.publishedAt.slice(0, 10),
    f: j.firstSeen.slice(0, 10),
    ch: [...new Set(j.sources.map((x) => x.channel))],
    n: j.sources.length,
    z: j.size,
    lk: j.link?.status ?? "",
  }));
  const data = JSON.stringify({ rows, zh: CHANNEL_ZH, now: d.runStartedAt }).replace(/</g, "\\u003c");
  const a = d.audit?.score;
  const tiles: [string, string, string][] = [
    ["规则匹配", String(s.matches.length), `官方页 ${s.officialMatches.length} · 第三方 ${s.matches.length - s.officialMatches.length}`],
    ["待核实", String(s.review.length), `排除 ${s.reject.length}`],
    ["去重后岗位", String(s.postings.length), `${d.sightings} 条发现记录 · ${s.companies} 家公司`],
    ["官方近 7 / 30 天", `${s.m7} / ${s.m30}`, `匹配中；${s.mUnknown} 个无官方日期`],
    ["链接有效", `${s.linkValid}/${s.linkChecked}`, `失效 ${s.linkInvalid} · 受限 ${s.linkBlocked}`],
    ["误筛 / 漏筛", a ? `${pct(a.falseMatchRate, 0)} / ${pct(a.missRate, 0)}` : "待审计", a ? `盲评 n=${a.matchJudged}/${a.rejectJudged}` : "独立审核未运行"],
  ];
  const chRows = d.channels
    .map((c) => `<tr><th scope="row">${esc(CHANNEL_ZH[c.channel] ?? c.channel)}</th><td>${c.sightings}</td><td>${c.postings}</td><td>${c.exclusive}</td><td>${pct(c.duplicateRate)}</td><td>${c.matches}</td><td>${c.exclusiveMatches}</td><td>${c.published7d}/${c.published30d}</td></tr>`)
    .join("");
  const outreach = d.outreach
    .filter((o) => o.publicContacts.length || o.roles.some((r) => r.verdict === "match"))
    .slice(0, 40)
    .map((o) => `<li><b>${esc(o.company)}</b> <span class="muted">${esc(o.sizeBasis)}</span><br>${o.roles.slice(0, 3).map((r) => `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>`).join(" · ")}${o.publicContacts.length ? `<br><span class="mono">${o.publicContacts.map((c) => esc(c.value)).join(", ")}</span> <span class="muted">· ${esc(o.confidenceNote)}</span>` : ""}</li>`)
    .join("");
  const failed = d.outcomes.filter((o) => !o.ok);

  return `<title>New Grad AI Job Radar</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@500;700&family=Source+Sans+3:wght@400;600&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
/* Layout: a status strip of figures, then the channel ledger, then a filterable posting table; one column on phones. */
:root {
  --bg: #f5f7f6; --panel: #ffffff; --fg: #17201d; --muted: #5d6a66; --line: #d9e0dd;
  --accent: #0f6e5c; --accent-soft: #e0f0eb; --match: #1d7a3c; --review: #9a6500; --reject: #9b2c2c; --chip: #eef2f0;
  --display: "Familjen Grotesk", "Helvetica Neue", Arial, sans-serif;
  --body: "Source Sans 3", "Segoe UI", system-ui, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0f1513; --panel: #161e1b; --fg: #e3ebe7; --muted: #93a39d; --line: #2a3531;
  --accent: #5cc3a8; --accent-soft: #1b2e28; --match: #6fcf8a; --review: #e3b55a; --reject: #f08a8a; --chip: #1f2925; color-scheme: dark } }
:root[data-theme="dark"] {
  --bg: #0f1513; --panel: #161e1b; --fg: #e3ebe7; --muted: #93a39d; --line: #2a3531;
  --accent: #5cc3a8; --accent-soft: #1b2e28; --match: #6fcf8a; --review: #e3b55a; --reject: #f08a8a; --chip: #1f2925; color-scheme: dark }
body { background: var(--bg); color: var(--fg); font: 15px/1.5 var(--body); }
.wrap { max-width: 1240px; margin: 0 auto; padding-block: 24px 48px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); display: grid; gap: 28px; }
h1, h2 { font-family: var(--display); text-wrap: balance; margin: 0; }
h1 { font-size: 1.9rem; letter-spacing: -0.01em; }
h2 { font-size: 1.15rem; }
.lede { color: var(--muted); max-width: 70ch; margin: 6px 0 0; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
.tile { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; display: grid; gap: 2px; min-width: 0; }
.tile .k { font-size: .78rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.tile .v { font: 600 1.6rem/1.2 var(--mono); font-variant-numeric: tabular-nums; }
.tile .s { font-size: .82rem; color: var(--muted); }
.scroll { overflow-x: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
thead th { font-size: .78rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); background: var(--panel); position: sticky; top: 0; }
.ledger td { font-family: var(--mono); font-size: .88rem; text-align: right; }
.ledger thead th:not(:first-child) { text-align: right; }
.filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.filters input[type=search] { flex: 1 1 220px; min-width: 0; }
input, select { font: inherit; color: var(--fg); background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; }
input:focus-visible, select:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.seg button { font: inherit; border: 0; background: var(--panel); color: var(--fg); padding: 6px 10px; cursor: pointer; }
.seg button[aria-pressed=true] { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.pill { display: inline-block; font: 600 .74rem var(--mono); padding: 1px 7px; border-radius: 99px; border: 1px solid currentColor; white-space: nowrap; }
.match { color: var(--match); } .review { color: var(--review); } .reject { color: var(--reject); }
.chip { display: inline-block; font-size: .74rem; background: var(--chip); border-radius: 4px; padding: 0 6px; margin: 1px 2px 1px 0; white-space: nowrap; }
.chip.off { background: var(--accent-soft); color: var(--accent); }
.muted { color: var(--muted); font-size: .85rem; }
.mono { font-family: var(--mono); font-size: .85rem; }
a { color: var(--accent); }
.jobs td.t { min-width: 260px; }
.jobs .why { color: var(--muted); font-size: .82rem; }
.count { color: var(--muted); font-size: .9rem; }
ul.out { margin: 0; padding-left: 18px; display: grid; gap: 10px; }
@media (max-width: 640px) { h1 { font-size: 1.5rem; } .jobs td.t { min-width: 200px; } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
<div class="wrap">
  <header>
    <h1>New Grad AI Job Radar</h1>
    <p class="lede">${esc(d.runStartedAt.slice(0, 10))} 的多渠道发现结果：官方 ATS 监控名单、New Grad GitHub 列表、Gmail 职位提醒和 HN 招聘帖，按 ATS Job ID 或官方链接去重。信任等级 ${esc(d.trust)}，没有提交任何申请。</p>
  </header>
  <section class="tiles" aria-label="总览">${tiles.map(([k, v, sub]) => `<div class="tile"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span><span class="s">${esc(sub)}</span></div>`).join("")}</section>
  <section style="display:grid;gap:10px">
    <h2>渠道贡献</h2>
    <div class="scroll"><table class="ledger"><thead><tr><th>渠道</th><th>发现记录</th><th>岗位</th><th>独有</th><th>渠道内重复</th><th>匹配</th><th>独有匹配</th><th>官方近7/30天</th></tr></thead><tbody>${chRows}</tbody></table></div>
    <p class="muted">一个岗位可被多个渠道报告，列不能相加。近 7/30 天只认雇主 ATS 的发布时间。${failed.length ? ` 失败或跳过的来源 ${failed.length} 个，见报告。` : ""}</p>
  </section>
  <section style="display:grid;gap:10px">
    <h2>岗位</h2>
    <div class="filters">
      <div class="seg" role="group" aria-label="筛选结果">
        <button id="v-match" data-v="match" aria-pressed="true">匹配</button><button id="v-review" data-v="review" aria-pressed="false">待核实</button><button id="v-reject" data-v="reject" aria-pressed="false">排除（标题相关）</button>
      </div>
      <select id="ch" aria-label="渠道"><option value="">全部渠道</option></select>
      <select id="fresh" aria-label="官方发布"><option value="">任意发布时间</option><option value="7">官方近 7 天</option><option value="30">官方近 30 天</option></select>
      <label class="muted"><input type="checkbox" id="off"> 只看有官方页</label>
      <input type="search" id="q" placeholder="搜索公司、岗位、地点">
    </div>
    <div class="count" id="count"></div>
    <div class="scroll"><table class="jobs"><thead><tr><th>公司</th><th>岗位</th><th>地点</th><th>结果</th><th>来源</th><th>官方发布</th><th>链接</th></tr></thead><tbody id="tb"></tbody></table></div>
  </section>
  <section style="display:grid;gap:10px">
    <h2>小公司 Outreach（只起草，未发送）</h2>
    <p class="muted">${d.outreach.length} 家；以下是有匹配岗位或公开联系方式的前 40 家。联系方式只取自公开招聘帖原文。</p>
    <ul class="out">${outreach || "<li>无</li>"}</ul>
  </section>
</div>
<script>
const D = ${data};
const state = { v: "match", ch: "", fresh: "", off: false, q: "" };
const chs = [...new Set(D.rows.flatMap(r => r.ch))].sort();
const sel = document.getElementById("ch");
for (const c of chs) { const o = document.createElement("option"); o.value = c; o.textContent = D.zh[c] || c; sel.append(o); }
const days = (p) => p ? (Date.parse(D.now) - Date.parse(p)) / 864e5 : Infinity;
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function render() {
  const q = state.q.toLowerCase();
  const rows = D.rows.filter(r => r.v === state.v && (!state.ch || r.ch.includes(state.ch)) && (!state.off || r.o) && (!state.fresh || days(r.p) <= +state.fresh) && (!q || (r.c + " " + r.t + " " + r.l).toLowerCase().includes(q)));
  document.getElementById("count").textContent = rows.length + " 个岗位" + (rows.length > 600 ? "，显示前 600 个" : "");
  document.getElementById("tb").innerHTML = rows.slice(0, 600).map(r => "<tr><td>" + esc(r.c) + (r.z === "medium_large" ? ' <span class="chip">中大型</span>' : r.z === "small_proxy" ? ' <span class="chip">小</span>' : "") + "</td>" +
    '<td class="t"><a href="' + esc(r.u) + '" target="_blank" rel="noopener">' + esc(r.t) + '</a><div class="why">' + esc(r.why) + "</div></td>" +
    "<td>" + esc(r.l) + "</td>" +
    '<td><span class="pill ' + r.v + '">' + esc(r.r) + "</span></td>" +
    "<td>" + r.ch.map(c => '<span class="chip' + (c.startsWith("official") ? " off" : "") + '">' + esc(D.zh[c] || c) + "</span>").join("") + "</td>" +
    '<td class="mono">' + (r.p || "—") + "</td>" +
    '<td class="mono">' + (r.lk || "—") + "</td></tr>").join("");
}
document.querySelectorAll(".seg button").forEach(b => b.addEventListener("click", () => {
  state.v = b.dataset.v;
  document.querySelectorAll(".seg button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  render();
}));
sel.addEventListener("change", e => { state.ch = e.target.value; render(); });
document.getElementById("fresh").addEventListener("change", e => { state.fresh = e.target.value; render(); });
document.getElementById("off").addEventListener("change", e => { state.off = e.target.checked; render(); });
document.getElementById("q").addEventListener("input", e => { state.q = e.target.value; render(); });
render();
</script>
`;
}
