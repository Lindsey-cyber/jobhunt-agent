import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Real captures (fixtures/greenhouse/real-*.html, scripts stripped). Without
// scripts the react-select dropdowns cannot open, so these test what the
// extractor reads from the markup; filling them is proven by live draft runs.
const EXTRACT = readFileSync(join(import.meta.dirname, "../src/ats/greenhouse/extract.browser.js"), "utf8");
let browser: Browser;
beforeAll(async () => (browser = await chromium.launch()));
afterAll(async () => browser.close());

async function fields(fixture: string) {
  const page = await browser.newPage();
  await page.setContent(readFileSync(join(import.meta.dirname, "../fixtures/greenhouse", fixture), "utf8"));
  const out = (await page.evaluate(`(${EXTRACT})(document.querySelector("form#application-form"))`)) as { id: string; label: string; kind: string; required: boolean }[];
  await page.close();
  return out;
}

describe("Greenhouse extract on a real capture (Scale AI, 2026-10-28)", () => {
  it("skips the phone country picker's search box", async () => {
    const f = await fields("real-scaleai-4728014005.html");
    expect(f.map((x) => x.id)).not.toContain("iti-0__search-input");
    expect(f.find((x) => x.id === "phone")).toMatchObject({ kind: "text", required: true });
  });

  it("names file inputs by their upload group and keeps the screening questions", async () => {
    const f = await fields("real-scaleai-4728014005.html");
    expect(f.find((x) => x.id === "resume")).toMatchObject({ kind: "file", label: "Resume/CV", required: false });
    expect(f.filter((x) => x.id.startsWith("question_"))).toHaveLength(7);
    expect(f.find((x) => /sponsorship/i.test(x.label))).toMatchObject({ kind: "combobox", required: true });
  });
});
