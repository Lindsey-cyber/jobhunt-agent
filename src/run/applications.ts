// The candidate's view of every application: what was filled, what the page
// held afterwards, and the screenshot taken just before submit.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import type { FillPlan } from "../plan/plan.ts";
import type { Ledger } from "../store/ledger.ts";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const STATE_ZH: Record<string, string> = { confirmed: "已提交（已确认）", unconfirmed: "已点击提交，未确认", submitted: "提交中", held: "暂停，等你处理", verified: "已核对", planned: "进行中" };

// Downsizes a full-page PNG to a JPEG the page can carry.
async function thumbnails(shots: { from: string; to: string }[]): Promise<void> {
  if (!shots.length) return;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  for (const s of shots) {
    const data = readFileSync(s.from).toString("base64");
    await page.setContent(`<body style="margin:0"><img id="i" style="width:640px;display:block" src="data:image/png;base64,${data}"></body>`);
    await page.locator("#i").screenshot({ path: s.to, type: "jpeg", quality: 55 });
  }
  await browser.close();
}

export async function writeApplicationsPage(ledger: Ledger, outDir: string): Promise<string> {
  mkdirSync(join(outDir, "shots"), { recursive: true });
  const entries = ledger.latest().filter((e) => ["confirmed", "unconfirmed", "submitted", "held"].includes(e.state)).sort((a, b) => b.at.localeCompare(a.at));
  const shots: { from: string; to: string }[] = [];
  const cards = entries.map((e, n) => {
    // The run that finished a submit (e.g. entering an emailed code) may not hold the plan; use the last one that does.
    const runDir = [e, ...ledger.history(e.key).reverse()].map((x) => x.runDir).find((d) => existsSync(join(d, "plan.json")));
    if (!runDir) return "";
    const planPath = join(runDir, "plan.json");
    const plan = JSON.parse(readFileSync(planPath, "utf8")) as FillPlan;
    const readback = existsSync(join(runDir, "readback.json")) ? (JSON.parse(readFileSync(join(runDir, "readback.json"), "utf8")) as Record<string, string>) : {};
    const shot = join(runDir, "before-submit.png");
    const img = `shots/${n}.jpg`;
    if (existsSync(shot)) shots.push({ from: shot, to: join(outDir, img) });
    const reasons = (e.detail as { reasons?: string[] } | undefined)?.reasons ?? [];
    const rows = plan.items
      .map((i) => {
        const filled = i.status === "fill" ? (i.field.kind === "file" ? String(i.value).split("/").pop() : i.value) : "";
        const note = i.status === "fill" ? "" : i.reason;
        return `<tr class="${i.status}"><td>${esc(i.field.label)}</td><td>${esc(filled)}</td><td>${esc(readback[i.field.id] ?? "")}</td><td>${esc(note)}</td></tr>`;
      })
      .join("");
    const posting = plan.form.url.replace("/embed/job_app?for=", "/").replace("&token=", "/jobs/");
    return `<section class="card ${e.state}">
  <header><h2>${esc(plan.form.company)} · ${esc(plan.form.jobTitle)}</h2>
  <p><span class="pill ${e.state}">${esc(STATE_ZH[e.state] ?? e.state)}</span> ${esc(e.at.slice(0, 16).replace("T", " "))} UTC · <a href="${esc(posting)}" target="_blank" rel="noopener">岗位页面</a></p>
  ${reasons.length ? `<ul class="reasons">${reasons.slice(0, 8).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}</header>
  <details><summary>填写内容（${plan.items.filter((i) => i.status === "fill").length} 项已填）</summary>
  <div class="scroll"><table><thead><tr><th>问题</th><th>填写</th><th>页面读回</th><th>未填原因</th></tr></thead><tbody>${rows}</tbody></table></div></details>
  ${existsSync(shot) ? `<details><summary>提交前截图</summary><img src="${img}" alt="提交前的页面" loading="lazy"></details>` : ""}
</section>`;
  });
  await thumbnails(shots);
  const counts = (s: string) => entries.filter((e) => e.state === s).length;
  const html = `<title>Job Applications</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
/* One column of application cards, newest first; details collapse the long tables. */
:root { --bg:#f6f7f5; --panel:#fff; --fg:#1b2420; --muted:#5f6b66; --line:#dde3df; --ok:#1d7a3c; --warn:#9a6500; --bad:#9b2c2c; --accent:#0f6e5c; --chip:#eef2f0; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#0f1513; --panel:#161e1b; --fg:#e3ebe7; --muted:#93a39d; --line:#2a3531; --ok:#6fcf8a; --warn:#e3b55a; --bad:#f08a8a; --accent:#5cc3a8; --chip:#1f2925; color-scheme: dark } }
:root[data-theme="dark"] { --bg:#0f1513; --panel:#161e1b; --fg:#e3ebe7; --muted:#93a39d; --line:#2a3531; --ok:#6fcf8a; --warn:#e3b55a; --bad:#f08a8a; --accent:#5cc3a8; --chip:#1f2925; color-scheme: dark }
body { background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, "Segoe UI", sans-serif; }
main { max-width: 1000px; margin: 0 auto; padding-block: 24px 48px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); display: grid; gap: 16px; }
h1 { margin: 0; font-size: 1.6rem; } h2 { margin: 0; font-size: 1.05rem; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; display: grid; gap: 8px; min-width: 0; }
.card p { margin: 0; color: var(--muted); font-size: .9rem; }
.pill { display: inline-block; font-size: .78rem; font-weight: 600; padding: 1px 8px; border-radius: 99px; border: 1px solid currentColor; }
.pill.confirmed { color: var(--ok); } .pill.held, .pill.unconfirmed { color: var(--warn); } .pill.submitted { color: var(--accent); }
.reasons { margin: 0; padding-left: 18px; color: var(--warn); font-size: .88rem; }
summary { cursor: pointer; color: var(--accent); }
.scroll { overflow-x: auto; } table { border-collapse: collapse; width: 100%; font-size: .86rem; }
th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
tr.blocked td:first-child { color: var(--bad); } tr.skip td { color: var(--muted); }
img { max-width: 100%; border: 1px solid var(--line); border-radius: 6px; margin-top: 8px; }
a { color: var(--accent); }
</style>
<main>
<h1>Job Applications</h1>
<p style="margin:0;color:var(--muted)">已确认 ${counts("confirmed")} · 未确认 ${counts("unconfirmed")} · 暂停 ${counts("held")}。“页面读回”是填写后从页面上读回的值，和“填写”一致才会提交。Greenhouse 的申请也可以用 lm3879@columbia.edu 登录 my.greenhouse.io 查看。</p>
${cards.join("\n")}
</main>`;
  const out = join(outDir, "applications.html");
  writeFileSync(out, html);
  return out;
}
