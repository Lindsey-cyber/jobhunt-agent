// Search-coverage measurement (read-only). Usage:
//   npx tsx scripts/coverage-sample.ts [--sample sample.json] [--save sample.json] [--max 100] [--json out.json]
// Pulls fitting postings from lists the pipeline does NOT fetch (see config/watchlist.yaml `github:`),
// then checks each against data/discovery/catalog.jsonl(.gz) by company+title (these lists carry no ATS ids).
// A sample file is [{company,title,location,date,list,applyUrl?}]; it replaces the fetch.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "yaml";
import { readCatalog } from "../src/store/catalog.ts";

interface Row { company: string; title: string; location: string; date: string; list: string; applyUrl?: string | undefined }
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const MAX = Number(arg("--max") ?? 100);
const NOW = new Date(process.env.COVERAGE_NOW ?? Date.now());
const LISTS = [
  { name: "jobright-ai/2026-Data-Analysis-New-Grad", raw: "https://raw.githubusercontent.com/jobright-ai/2026-Data-Analysis-New-Grad/master/README.md" },
  { name: "jobright-ai/2026-Software-Engineer-New-Grad", raw: "https://raw.githubusercontent.com/jobright-ai/2026-Software-Engineer-New-Grad/master/README.md" },
  { name: "vanshb03/New-Grad-2027", raw: "https://raw.githubusercontent.com/vanshb03/New-Grad-2027/dev/README.md" },
];
const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/\b(inc|llc|ltd|corp|corporation|co|company|the)\b\.?/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const ntitle = (s: string) => norm(s.replace(/\(.*?\)|\[.*?\]/g, " ").replace(/\b(new (college )?grad(uate)?|early career|university grad(uate)?|campus|2026|2027|full[- ]time)\b/gi, " "));
const toks = (s: string) => new Set(ntitle(s).split(" ").filter((t) => t.length > 1));
const jac = (a: Set<string>, b: Set<string>) => { let i = 0; for (const t of a) if (b.has(t)) i++; return i / (a.size + b.size - i || 1); };

const FIT = /machine learning|\bml\b|\bai\b|artificial intelligence|data scien|data engineer|applied scien|research (engineer|scien)|computer vision|\bnlp\b|deep learning|\bllm|generative|\bgenai\b|perception|\bmlops\b/i;
const NOFIT = /\b(senior|sr\.?|staff|principal|lead|manager|director|intern|internship|co-?op|phd|ph\.d)\b/i;
const US = /\b(United States|USA|US|Remote|[A-Z][a-z]+(?: [A-Z][a-z]+)*, (?:A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY]))\b/;
const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function text(cell: string): string {
  return cell.replace(/<[^>]+>/g, " ").replace(/\]\([^)]*\)/g, "").replace(/[\[\]]/g, "").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
}
function link(cell: string): string | undefined {
  return /\]\((https?:[^)\s]+)\)/.exec(cell)?.[1] ?? /href="([^"]+)"/.exec(cell)?.[1];
}
function parseDate(s: string): Date | undefined {
  const m = /([A-Za-z]{3})[a-z]*\.? (\d{1,2})/.exec(s);
  if (!m) return undefined;
  const mo = MON.indexOf(m[1]!.toLowerCase());
  if (mo < 0) return undefined;
  let y = NOW.getUTCFullYear();
  let d = new Date(Date.UTC(y, mo, Number(m[2])));
  if (d.getTime() > NOW.getTime() + 864e5) d = new Date(Date.UTC(y - 1, mo, Number(m[2])));
  return d;
}
function parseList(name: string, md: string): Row[] {
  const out: Row[] = [];
  let prev = "";
  for (const l of md.split("\n")) {
    if (!l.startsWith("|")) continue;
    const c = l.split("|").slice(1, -1);
    if (c.length < 4 || /^\s*:?-+/.test(c[0]!) || /^\s*\**company/i.test(c[0]!)) continue;
    let company = text(c[0]!);
    if (company.startsWith("↳")) company = prev; else prev = company;
    const date = text(c[c.length - 1]!);
    const loc = text(c[2]!);
    out.push({ company, title: text(c[1]!), location: loc, date, list: name, applyUrl: link(c[3]!) ?? link(c[1]!) });
  }
  return out;
}
function curl(url: string): string { return execFileSync("curl", ["-sS", "-L", "-m", "60", url], { maxBuffer: 1 << 28 }).toString("utf8"); }

function loadRows(): Row[] {
  const f = arg("--sample");
  if (f) return JSON.parse(readFileSync(f, "utf8")) as Row[];
  return LISTS.flatMap((l) => parseList(l.name, curl(l.raw)));
}

const policy = parse(readFileSync("data/policy.yaml", "utf8")) as { excludeCompanies: string[] };
const excluded = policy.excludeCompanies.map((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));
const wl = parse(readFileSync("config/watchlist.yaml", "utf8")) as Record<string, Array<{ company?: string }>>;
const watched = new Set(["greenhouse", "lever", "ashby", "workday"].flatMap((k) => (wl[k] ?? []).map((e) => norm(e.company ?? ""))));

let rows = loadRows();
const total = rows.length;
const seen = new Set<string>();
const sample: Row[] = [];
for (const r of rows) {
  const d = parseDate(r.date);
  if (!arg("--sample") && (!d || NOW.getTime() - d.getTime() > 30 * 864e5)) continue;
  if (!FIT.test(r.title) || NOFIT.test(r.title) || !US.test(r.location) || /united kingdom|canada|india|germany|australia|new zealand/i.test(r.location)) continue;
  if (excluded.some((e) => e.test(r.company))) continue;
  const k = `${norm(r.company)}|${ntitle(r.title)}`;
  if (seen.has(k)) continue;
  seen.add(k);
  sample.push(r);
}
sample.sort((a, b) => (a.company + a.title).localeCompare(b.company + b.title));
const picked = sample.length > MAX ? Array.from({ length: MAX }, (_, k) => sample[Math.floor((k * sample.length) / MAX)]!) : sample;
if (arg("--save")) writeFileSync(arg("--save")!, JSON.stringify(picked, null, 1));

const cat = [...readCatalog("data/discovery/catalog.jsonl").values()];
const byCo = new Map<string, typeof cat>();
for (const j of cat) { const k = norm(j.company); (byCo.get(k) ?? byCo.set(k, []).get(k)!).push(j); }
const lastRun = JSON.parse(readFileSync("data/discovery/latest.json", "utf8")).startedAt as string;

function atsHost(url?: string): string {
  if (!url) return "?";
  try {
    const out = execFileSync("curl", ["-sS", "-L", "-m", "12", "-o", "/dev/null", "-w", "%{url_effective}", url], { stdio: ["ignore", "pipe", "ignore"] }).toString();
    return new URL(out).hostname.replace(/^www\./, "");
  } catch { return "?"; }
}

interface Res { row: Row; status: "hit" | "hit_fuzzy" | "miss"; verdict?: string; rule?: string; cause?: string; host?: string }
const results: Res[] = [];
for (const r of picked) {
  const js = byCo.get(norm(r.company)) ?? [];
  // A catalog row is a candidate only if it is not itself a senior/intern title and not an overseas copy.
  const cand = js.filter((j) => !NOFIT.test(j.title) && j.triage.rule !== "location.non_us");
  const exact = cand.find((j) => ntitle(j.title) === ntitle(r.title));
  const tk = toks(r.title);
  const fuzzy = exact ? undefined : cand.map((j) => ({ j, s: jac(tk, toks(j.title)) })).sort((a, b) => b.s - a.s).find((x) => x.s >= 0.75)?.j;
  const hit = exact ?? fuzzy;
  if (hit) { results.push({ row: r, status: exact ? "hit" : "hit_fuzzy", verdict: hit.triage.verdict, rule: hit.triage.rule }); continue; }
  let cause: string;
  const isWatched = watched.has(norm(r.company));
  if (js.length === 0) cause = isWatched ? "watched company but zero rows (board empty or failed)" : "company absent from catalog (not on watchlist)";
  else {
    const offic = js.some((j) => j.official);
    cause = offic ? "company on watchlist; this posting not on its board (or title differs beyond 0.75 similarity)" : "company seen only via alert/list; no official board fetched";
  }
  results.push({ row: r, status: "miss", cause, host: atsHost(r.applyUrl) });
}

const n = results.length;
const hits = results.filter((x) => x.status !== "miss");
const ok = hits.filter((x) => x.verdict !== "reject");
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "n/a");
const count = <T,>(xs: T[], f: (x: T) => string) => { const m = new Map<string, number>(); xs.forEach((x) => m.set(f(x), (m.get(f(x)) ?? 0) + 1)); return [...m].sort((a, b) => b[1] - a[1]); };
const report = {
  now: NOW.toISOString(), lastRun, rowsParsed: total, fittingUnique: sample.length, n,
  inCatalog: hits.length, coverage: pct(hits.length, n), exact: results.filter((x) => x.status === "hit").length,
  inCatalogNotRejected: ok.length, coverageNotRejected: pct(ok.length, n),
  hitVerdicts: count(hits, (x) => `${x.verdict}:${x.rule}`),
  missCauses: count(results.filter((x) => x.status === "miss"), (x) => x.cause!),
  missHosts: count(results.filter((x) => x.status === "miss"), (x) => x.host ?? "?"),
  misses: results.filter((x) => x.status === "miss").map((x) => ({ ...x.row, cause: x.cause, host: x.host })),
  hitButRejected: hits.filter((x) => x.verdict === "reject").map((x) => ({ ...x.row, rule: x.rule })),
};
if (arg("--json")) writeFileSync(arg("--json")!, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ ...report, misses: undefined, hitButRejected: report.hitButRejected.length }, null, 1));
for (const m of report.misses) console.log(`MISS | ${m.company} | ${m.title} | ${m.location} | ${m.date} | ${m.list.split("/")[0]} | ${m.host} | ${m.cause}`);
