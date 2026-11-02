// Stage gates (docs/program/notes.md): 1a search is complete, 1b screening is accurate,
// 1c applying is allowed only when both hold. Pure: the CLI reads the files.
import type { DateKind } from "../domain/job.ts";

export interface Check { name: string; value: string; pass: boolean }
// notes are shown on the page and never decide the gate.
export interface Gate { pass: boolean; checks: Check[]; notes?: string[] }

export interface AuditRates { falseMatchRate: number | null; missRate: number | null; matchJudged: number; rejectJudged: number }

// A match is dated when the employer's own page says when it was published, or a
// list that carries the posting says so (list_posted) or gives a day-level age
// ("3d", "today": list_age_day). Coarse ages ("2w", "1mo": list_age), bounds
// ("30d+", posted_before), email receipt and HN post time never count.
export interface DatedMatch { publishedAt: string; sources?: readonly { dateKind: DateKind; date: string }[] }
export function isDated(m: DatedMatch): boolean {
  if (m.publishedAt.trim() !== "") return true;
  return (m.sources ?? []).some((s) => (s.dateKind === "list_posted" || s.dateKind === "list_age_day") && s.date.trim() !== "");
}

export interface GateInput {
  // A deferred row is accounted for only with a written reason; it is listed on the page.
  registry?: readonly { id?: string; status: "live" | "no_api" | "deferred" | "not_built"; reason?: string | undefined }[] | undefined;
  today: string;
  matches: DatedMatch[];
  audit?: AuditRates | undefined;
}

export const GATE_LIMITS = { dated: 0.9, auditRate: 0.1, auditN: 15 } as const;

// Per-company completeness (is each target company's official board fully read today) is not built yet,
// so it is never measured and never passes. The sampled third-party coverage it replaces is gone.
export const NOT_MEASURED = "未测量: per-company completeness not built yet";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const rate = (x: number | null) => (x == null ? "无数据" : pct(x));

export function stageGates(i: GateInput): Record<"1a" | "1b" | "1c", Gate> {
  const gate = (checks: Check[]): Gate => ({ pass: checks.every((c) => c.pass), checks });
  const notBuilt = i.registry?.filter((r) => r.status === "not_built").length;
  const deferred = i.registry?.filter((r) => r.status === "deferred") ?? [];
  const noReason = deferred.filter((r) => !(r.reason ?? "").trim());
  const registryOk = !!i.registry && i.registry.length > 0 && notBuilt === 0 && noReason.length === 0;
  const registryValue = !i.registry
    ? "来源登记表未建"
    : i.registry.length === 0
      ? "来源登记表是空的"
      : `${notBuilt} 个未做；${deferred.length} 个推迟${noReason.length ? `，其中 ${noReason.length} 个没写理由（${noReason.map((r) => r.id ?? "?").join("、")}）` : deferred.length ? `（都有理由：${deferred.map((r) => r.id ?? "?").join("、")}）` : ""}`;
  const dated = i.matches.filter(isDated).length;
  const datedShare = i.matches.length ? dated / i.matches.length : NaN;
  const a = i.audit;

  const g1a = gate([
    { name: "每家目标公司的官方招聘板今天读完", value: NOT_MEASURED, pass: false },
    { name: "来源登记表没有“未做”，推迟的都有理由", value: registryValue, pass: registryOk },
    { name: `当前匹配岗位有发布日期（官方或列表注明的日期）≥ ${pct(GATE_LIMITS.dated)}`, value: i.matches.length ? `${dated}/${i.matches.length} = ${pct(datedShare)}` : "没有当前匹配岗位", pass: datedShare >= GATE_LIMITS.dated },
  ]);
  const g1b = gate([
    { name: `盲审误选率 ≤ ${pct(GATE_LIMITS.auditRate)}（n ≥ ${GATE_LIMITS.auditN}）`, value: a ? `${rate(a.falseMatchRate)}，n=${a.matchJudged}` : "没有盲审记录", pass: !!a && a.falseMatchRate != null && a.matchJudged >= GATE_LIMITS.auditN && a.falseMatchRate <= GATE_LIMITS.auditRate },
    { name: `盲审漏选率 ≤ ${pct(GATE_LIMITS.auditRate)}（n ≥ ${GATE_LIMITS.auditN}）`, value: a ? `${rate(a.missRate)}，n=${a.rejectJudged}` : "没有盲审记录", pass: !!a && a.missRate != null && a.rejectJudged >= GATE_LIMITS.auditN && a.missRate <= GATE_LIMITS.auditRate },
    { name: "在库但被规则误拒", value: NOT_MEASURED, pass: false },
  ]);
  const g1c = gate([
    { name: "1a 搜全通过", value: g1a.pass ? "通过" : "未通过", pass: g1a.pass },
    { name: "1b 筛对通过", value: g1b.pass ? "通过" : "未通过", pass: g1b.pass },
  ]);
  return { "1a": g1a, "1b": g1b, "1c": g1c };
}

export function renderGates(g: ReturnType<typeof stageGates>): string[] {
  const names = { "1a": "1a 搜全", "1b": "1b 筛对", "1c": "1c 投出" } as const;
  const L = ["## 阶段门", "", "1a、1b 都通过前，投递命令拒绝运行。", ""];
  for (const k of ["1a", "1b", "1c"] as const) {
    L.push(`**${names[k]}：${g[k].pass ? "✓ 通过" : "✗ 未通过"}**`, "");
    for (const c of g[k].checks) L.push(`- ${c.pass ? "✓" : "✗"} ${c.name}：${c.value}`);
    for (const n of g[k].notes ?? []) L.push(`- ℹ ${n}`);
    L.push("");
  }
  return L;
}
