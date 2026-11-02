// Stage gates (docs/program/notes.md): 1a search is complete, 1b screening is accurate,
// 1c applying is allowed only when both hold. Pure: the CLI reads the files.
import type { DateKind } from "../domain/job.ts";
import { bigCounts, type BandCounts } from "./coverage.ts";

export interface Check { name: string; value: string; pass: boolean }
// notes are shown on the page and never decide the gate.
export interface Gate { pass: boolean; checks: Check[]; notes?: string[] }

// bands (optional): the same counts split by employer size. When present, gate 1a judges large + mid rows only
// (the candidate: search resources are not to go mostly to small startups); small and unknown are reported.
export interface Coverage { date: string; n: number; inCatalog: number; inCatalogNotRejected: number; bands?: BandCounts }
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
  coverage?: Coverage | undefined;
  coverageProblem?: string | undefined; // a measurement file was rejected: counts as missing
  // A deferred row is accounted for only with a written reason; it is listed on the page.
  registry?: readonly { id?: string; status: "live" | "no_api" | "deferred" | "not_built"; reason?: string | undefined }[] | undefined;
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
  // The rows gate 1a counts: large + mid employers when the file splits by size, else every row (older files).
  const g = c ? (c.bands ? bigCounts(c.bands) : { n: c.n, inCatalog: c.inCatalog }) : undefined;
  const share = g && g.n > 0 ? g.inCatalog / g.n : NaN;
  const scope = c?.bands ? "大中型雇主" : "";
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
  const wrong = c && c.inCatalog > 0 ? (c.inCatalog - c.inCatalogNotRejected) / c.inCatalog : NaN;

  const sizeNote = (label: string, k: "small" | "unknown") => `${label}雇主：${c!.bands![k].inCatalog}/${c!.bands![k].n} 在库（只报告，不设门）`;
  const g1a = gate([
    { name: `覆盖率测量在 ${GATE_LIMITS.coverageDays} 天内`, value: c ? `${c.date}（${age} 天前）` : NO_COVERAGE, pass: !!c && age >= 0 && age <= GATE_LIMITS.coverageDays },
    { name: `覆盖率样本${scope} n ≥ ${GATE_LIMITS.coverageN}`, value: c ? `n=${g!.n}` : NO_COVERAGE, pass: !!g && g.n >= GATE_LIMITS.coverageN },
    { name: `${scope}样本在库内 ≥ ${pct(GATE_LIMITS.inCatalog)}`, value: c ? (g!.n > 0 ? `${g!.inCatalog}/${g!.n} = ${pct(share)}` : "n=0") : NO_COVERAGE, pass: share >= GATE_LIMITS.inCatalog },
    { name: "来源登记表没有“未做”，推迟的都有理由", value: registryValue, pass: registryOk },
    { name: `当前匹配岗位有发布日期（官方或列表注明的日期）≥ ${pct(GATE_LIMITS.dated)}`, value: i.matches.length ? `${dated}/${i.matches.length} = ${pct(datedShare)}` : "没有当前匹配岗位", pass: datedShare >= GATE_LIMITS.dated },
  ]);
  if (c?.bands) g1a.notes = [sizeNote("小型", "small"), sizeNote("规模未知", "unknown")];
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
    for (const n of g[k].notes ?? []) L.push(`- ℹ ${n}`);
    L.push("");
  }
  return L;
}
