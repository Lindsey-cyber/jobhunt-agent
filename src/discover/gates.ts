// Stage gates (docs/program/notes.md): 1a search is complete, 1b screening is accurate,
// 1c applying is allowed only when both hold. Pure: the CLI reads the files.
import type { DateKind } from "../domain/job.ts";

export interface Check { name: string; value: string; pass: boolean }
export interface Gate { pass: boolean; checks: Check[] }

export interface Coverage { date: string; n: number; inCatalog: number; inCatalogNotRejected: number }
export interface AuditRates { falseMatchRate: number | null; missRate: number | null; matchJudged: number; rejectJudged: number }

// A match is dated when the employer's own page says when it was published, or a
// list that carries the posting says so (dateKind list_posted). Bounds ("30d+",
// posted_before), email receipt and HN post time never count.
export interface DatedMatch { publishedAt: string; sources?: readonly { dateKind: DateKind; date: string }[] }
export function isDated(m: DatedMatch): boolean {
  if (m.publishedAt.trim() !== "") return true;
  return (m.sources ?? []).some((s) => s.dateKind === "list_posted" && s.date.trim() !== "");
}

export interface GateInput {
  coverage?: Coverage | undefined;
  coverageProblem?: string | undefined; // a measurement file was rejected: counts as missing
  registry?: readonly { status: "live" | "no_api" | "not_built" }[] | undefined;
  today: string;
  matches: DatedMatch[];
  audit?: AuditRates | undefined;
}

export const GATE_LIMITS = { coverageDays: 7, coverageN: 50, inCatalog: 0.95, dated: 0.9, auditRate: 0.1, auditN: 15, wrongReject: 0.05 } as const;

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const rate = (x: number | null) => (x == null ? "无数据" : pct(x));
const days = (from: string, to: string) => Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000);

export function stageGates(i: GateInput): Record<"1a" | "1b" | "1c", Gate> {
  const gate = (checks: Check[]): Gate => ({ pass: checks.every((c) => c.pass), checks });
  const c = i.coverage;
  const NO_COVERAGE = i.coverageProblem ? `覆盖率测量文件不可用：${i.coverageProblem}` : "没有覆盖率测量文件";
  const age = c ? days(c.date, i.today) : NaN;
  const share = c && c.n > 0 ? c.inCatalog / c.n : NaN;
  const notBuilt = i.registry?.filter((r) => r.status === "not_built").length;
  const registryOk = !!i.registry && i.registry.length > 0 && notBuilt === 0;
  const dated = i.matches.filter(isDated).length;
  const datedShare = i.matches.length ? dated / i.matches.length : NaN;
  const a = i.audit;
  const wrong = c && c.inCatalog > 0 ? (c.inCatalog - c.inCatalogNotRejected) / c.inCatalog : NaN;

  const g1a = gate([
    { name: `覆盖率测量在 ${GATE_LIMITS.coverageDays} 天内`, value: c ? `${c.date}（${age} 天前）` : NO_COVERAGE, pass: !!c && age >= 0 && age <= GATE_LIMITS.coverageDays },
    { name: `覆盖率样本 n ≥ ${GATE_LIMITS.coverageN}`, value: c ? `n=${c.n}` : NO_COVERAGE, pass: !!c && c.n >= GATE_LIMITS.coverageN },
    { name: `样本在库内 ≥ ${pct(GATE_LIMITS.inCatalog)}`, value: c ? (c.n > 0 ? `${c.inCatalog}/${c.n} = ${pct(share)}` : "n=0") : NO_COVERAGE, pass: share >= GATE_LIMITS.inCatalog },
    { name: "来源登记表没有“未做”", value: !i.registry ? "来源登记表未建" : i.registry.length === 0 ? "来源登记表是空的" : `${notBuilt} 个未做`, pass: registryOk },
    { name: `当前匹配岗位有发布日期（官方或列表注明的日期）≥ ${pct(GATE_LIMITS.dated)}`, value: i.matches.length ? `${dated}/${i.matches.length} = ${pct(datedShare)}` : "没有当前匹配岗位", pass: datedShare >= GATE_LIMITS.dated },
  ]);
  const g1b = gate([
    { name: `盲审误选率 ≤ ${pct(GATE_LIMITS.auditRate)}（n ≥ ${GATE_LIMITS.auditN}）`, value: a ? `${rate(a.falseMatchRate)}，n=${a.matchJudged}` : "没有盲审记录", pass: !!a && a.falseMatchRate != null && a.matchJudged >= GATE_LIMITS.auditN && a.falseMatchRate <= GATE_LIMITS.auditRate },
    { name: `盲审漏选率 ≤ ${pct(GATE_LIMITS.auditRate)}（n ≥ ${GATE_LIMITS.auditN}）`, value: a ? `${rate(a.missRate)}，n=${a.rejectJudged}` : "没有盲审记录", pass: !!a && a.missRate != null && a.rejectJudged >= GATE_LIMITS.auditN && a.missRate <= GATE_LIMITS.auditRate },
    { name: `在库但被规则误拒 ≤ ${pct(GATE_LIMITS.wrongReject)}`, value: c ? (c.inCatalog > 0 ? `${c.inCatalog - c.inCatalogNotRejected}/${c.inCatalog} = ${pct(wrong)}` : "样本里没有在库岗位") : NO_COVERAGE, pass: wrong <= GATE_LIMITS.wrongReject },
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
    L.push("");
  }
  return L;
}
