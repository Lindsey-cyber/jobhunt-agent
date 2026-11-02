import { describe, expect, it } from "vitest";
import { filerName, matchesCompany, parseH1bTable, recordFrom, sponsorVerdict } from "../src/discover/h1b.ts";

const row = (employer: string, date: string) => `<tr><td><a href='x'>${employer}</a></td><td>SOFTWARE ENGINEER</td><td>145,912</td><td>NEW YORK, NY</td><td class='d-sm-none'>${date}</td><td class='d-sm-none'>10/01/2025</td></tr>`;

describe("H-1B history", () => {
  it("matches filer names to the company, not to longer or unrelated names", () => {
    expect(matchesCompany("STRIPE INC", "Stripe")).toBe(true);
    expect(matchesCompany("SCALE AI INC", "Scale AI")).toBe(true);
    expect(matchesCompany("WAYMO LLC", "Waymo")).toBe(true);
    expect(matchesCompany("FINRA", "Fin")).toBe(false);
    expect(matchesCompany("STRIPES GROUP LLC", "Stripe")).toBe(false);
    expect(matchesCompany("HP INC", "HP")).toBe(true);
    expect(matchesCompany("HOME DEPOT USA INC", "The Home Depot")).toBe(true);
  });
  it("searches well-known employers under their filer names", () => {
    expect(filerName("AMD")).toBe("ADVANCED MICRO DEVICES");
    expect(filerName("Together AI")).toBe("TOGETHER COMPUTER");
    expect(filerName("PlayStation Global")).toBe("SONY INTERACTIVE ENTERTAINMENT");
    expect(filerName("Stripe")).toBe("stripe");
  });
  it("counts the company's filings since 2023 and decides", () => {
    const html = `<table><tr><th>EMPLOYER</th></tr>${row("STRIPE INC", "09/08/2025")}${row("STRIPE INC", "03/01/2021")}${row("STRIPES GROUP LLC", "01/02/2024")}</table>`;
    const r = recordFrom("Stripe", parseH1bTable(html), "2026-11-02", 2023);
    expect(r).toMatchObject({ filings: 1, matched: ["STRIPE INC"] });
    expect(sponsorVerdict(r)).toBe("sponsor");
    expect(sponsorVerdict(recordFrom("Ludo Robotics", [], "2026-11-02", 2023))).toBe("none");
    expect(sponsorVerdict(undefined)).toBe("unknown");
    expect(recordFrom("S&P Global", parseH1bTable(row("S&amp;P GLOBAL INC", "05/01/2025")), "2026-11-02", 2023).filings).toBe(1);
  });
});
