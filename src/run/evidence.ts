// Each application's evidence, kept in the repo so every machine (the VPS, a
// cloud session) can show every application: the plan, what the page read back,
// the checks, the confirmation, and one small screenshot. The run directory under
// data/runs stays local and holds everything else.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

export const evidenceDir = (dataDir: string, key: string) => join(dataDir, "evidence", key.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 150));

const FILES = ["plan.json", "readback.json", "verify.json", "gate.json", "confirmation.json"];

// Downsizes a full-page PNG to a small JPEG.
export async function thumbnail(png: string, jpg: string): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 480, height: 400 } });
    await page.setContent(`<body style="margin:0"><img id="i" style="width:480px;display:block" src="data:image/png;base64,${readFileSync(png).toString("base64")}"></body>`);
    await page.locator("#i").screenshot({ path: jpg, type: "jpeg", quality: 38 });
  } finally {
    await browser.close();
  }
}

export async function archiveEvidence(dataDir: string, key: string, runDir: string): Promise<string> {
  const dir = evidenceDir(dataDir, key);
  mkdirSync(dir, { recursive: true });
  for (const f of FILES) if (existsSync(join(runDir, f))) copyFileSync(join(runDir, f), join(dir, f));
  // The filled form just before submit is what the candidate reviews.
  const before = join(runDir, "before-submit.png");
  if (existsSync(before)) await thumbnail(before, join(dir, "page.jpg")).catch(() => undefined);
  return dir;
}
