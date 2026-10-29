// Saves a live application form as a fixture: the DOM after it rendered, with
// scripts, tracking and anti-forgery tokens removed so tests never call out.
// Usage: npx tsx src/dev/capture.ts <url> <fixtures/ats/case.html> [click-selector]
// CAPTURE_WAIT_FOR=<selector> waits for slow single-page apps (Workday) to render.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright";

const [url, out, click] = process.argv.slice(2);
if (!url || !out) throw new Error("usage: capture.ts <url> <out.html> [click-selector]");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 2000 } });
await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => undefined);
if (click) {
  await page.locator(click).first().click();
  await page.waitForLoadState("networkidle").catch(() => undefined);
}
if (process.env.CAPTURE_WAIT_FOR) await page.locator(process.env.CAPTURE_WAIT_FOR).first().waitFor({ timeout: 45000 }).catch(() => console.error("wait-for selector never appeared"));
await page.waitForTimeout(1500);
const html = await page.evaluate(() => {
  const doc = document.documentElement.cloneNode(true) as HTMLElement;
  doc.querySelectorAll("script, noscript, iframe, link[rel=preload], link[rel=prefetch], link[rel=modulepreload]").forEach((e) => e.remove());
  doc.querySelectorAll("input[type=hidden]").forEach((e) => {
    const i = e as HTMLInputElement;
    if (/token|csrf|authenticity|captcha|nonce/i.test(i.name + i.id)) i.value = "SCRUBBED";
  });
  return "<!doctype html>\n" + doc.outerHTML;
});
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
await page.screenshot({ path: out.replace(/\.html$/, ".png"), fullPage: true });
console.log(`${out}: ${html.length} bytes from ${page.url()}`);
await browser.close();
