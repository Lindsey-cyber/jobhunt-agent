import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bandOfCompany, makeCanon } from "../src/discover/coverage.ts";
import { Watchlist } from "../src/sources/fetch.ts";
import { loadSizeSources } from "../src/sources/coverage.ts";

describe("coverage reads the band of every watchlist section that carries one", () => {
  it("takes jibe, oracleHcm, eightfold, smartrecruiters and pending bands as well as the board sections", () => {
    const wl = Watchlist.parse({
      jibe: [{ host: "careers.amd.com", company: "AMD", band: "large", h1b: 1984 }],
      oracleHcm: [{ host: "edbz.fa.us2.oraclecloud.com", site: "CX", company: "Texas Instruments", band: "mid" }],
      eightfold: [{ host: "eaton.eightfold.ai", domain: "eaton.com", api: "pcsx", company: "Eaton", band: "small" }],
      smartrecruiters: [{ id: "Cricut", company: "Cricut", band: "mid" }],
      pending: [{ company: "Peraton", band: "mid" }],
      greenhouse: [{ board: "stripe", company: "Stripe", band: "large" }],
    });
    const s = loadSizeSources(mkdtempSync(join(tmpdir(), "jh-band-")), 2023, wl);
    const canon = makeCanon(wl.aliases);
    expect(["AMD", "Texas Instruments", "Eaton", "Cricut", "Peraton", "Stripe"].map((c) => bandOfCompany(c, canon, s))).toEqual(["large", "mid", "small", "mid", "mid", "large"]);
  });
});
