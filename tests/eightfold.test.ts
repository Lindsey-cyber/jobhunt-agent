import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eightfoldInUS, parseEightfold, type EightfoldItem } from "../src/discover/parse.ts";
import { jobKey } from "../src/discover/identity.ts";
import { OFFICIAL_CHANNELS } from "../src/domain/job.ts";
import { SOURCE_REGISTRY } from "../src/discover/sources.ts";
import { loadWatchlist } from "../src/sources/fetch.ts";

const fx = <T>(name: string): T => JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8")) as T;
const SEEN = "2026-11-02T12:00:00.000Z";

describe("Eightfold apply/v2 (saved Netflix response, 2026-11-02)", () => {
  const list = fx<{ positions: EightfoldItem[] }>("eightfold-netflix-list.json").positions;
  const detail = fx<EightfoldItem>("eightfold-netflix-detail.json");

  it("turns a list item into an official sighting keyed by the position id", () => {
    const s = parseEightfold(list[0]!, "explore.jobs.netflix.net", "Netflix", SEEN)!;
    expect(s.channel).toBe("official_eightfold");
    expect(s.official).toBe(true);
    expect(s.url).toBe(`https://explore.jobs.netflix.net/careers/job/${list[0]!.id}`);
    expect(s.key).toBe(`eightfold:explore.jobs.netflix.net:${list[0]!.id}`);
    expect(s.title).toBe("Machine Learning Engineer (L4/L5) - Studio Media Algorithms");
    expect(s.location).toContain("Los Angeles");
  });

  it("reads t_create (Unix seconds) as the employer's publication day", () => {
    const s = parseEightfold(list[0]!, "explore.jobs.netflix.net", "Netflix", SEEN)!;
    expect(s.date).toBe(new Date(list[0]!.t_create! * 1000).toISOString());
    expect(s.dateKind).toBe("published");
  });

  it("merges the detail description in as plain text", () => {
    const s = parseEightfold({ ...list[0]!, ...detail }, "explore.jobs.netflix.net", "Netflix", SEEN)!;
    expect(s.description.length).toBeGreaterThan(200);
    expect(s.description).not.toMatch(/<[a-z]+>/);
  });

  it("keeps the same key whether the URL carries the microsite tracking parameter or not", () => {
    const id = list[0]!.id;
    expect(jobKey(`https://explore.jobs.netflix.net/careers/job/${id}?microsite=netflix.com`)).toBe(jobKey(`https://explore.jobs.netflix.net/careers/job/${id}`));
  });
});

describe("Eightfold pcsx (saved Eaton response, 2026-11-02)", () => {
  const list = fx<{ data: { positions: EightfoldItem[] } }>("eightfold-eaton-list.json").data.positions;
  const detail = fx<{ data: EightfoldItem }>("eightfold-eaton-detail.json").data;

  it("uses postedTs over creationTs and reads standardizedLocations", () => {
    const s = parseEightfold(list[0]!, "eaton.eightfold.ai", "Eaton", SEEN)!;
    expect(s.date).toBe(new Date(list[0]!.postedTs! * 1000).toISOString());
    expect(s.location).toContain("Beachwood, Ohio, USA");
    expect(s.key).toBe(`eightfold:eaton.eightfold.ai:${list[0]!.id}`);
  });

  it("reads jobDescription from the detail", () => {
    const s = parseEightfold({ ...list[0]!, ...detail }, "eaton.eightfold.ai", "Eaton", SEEN)!;
    expect(s.description.length).toBeGreaterThan(100);
  });
});

describe("Eightfold edge cases", () => {
  const ok: EightfoldItem = { id: 790319186617, name: "ML Engineer", locations: ["Remote, United States"], t_create: 1793059200 };

  it("skips an item with no id, a non-numeric id, or no title", () => {
    expect(parseEightfold({ name: "ML Engineer", locations: ["Remote, United States"] }, "h.example", "A", SEEN)).toBeUndefined();
    expect(parseEightfold({ ...ok, id: "abc" }, "h.example", "A", SEEN)).toBeUndefined();
    expect(parseEightfold({ ...ok, name: "  " }, "h.example", "A", SEEN)).toBeUndefined();
  });

  it("reports no date, never a published kind with an empty date, when the tenant gives none", () => {
    const s = parseEightfold({ id: ok.id!, name: "ML Engineer" }, "h.example", "A", SEEN)!;
    expect(s.date).toBe("");
    expect(s.dateKind).toBe("none");
    expect(parseEightfold({ ...ok, t_create: 0 }, "h.example", "A", SEEN)!.dateKind).toBe("none");
  });

  it("accepts a millisecond timestamp as well as seconds", () => {
    expect(parseEightfold({ ...ok, t_create: 1793059200000 }, "h.example", "A", SEEN)!.date).toBe("2026-10-27T00:00:00.000Z");
  });

  it("accepts a string id and prefers posting_name", () => {
    const s = parseEightfold({ ...ok, id: "790319186617", posting_name: "Posted Title" }, "h.example", "A", SEEN)!;
    expect(s.title).toBe("Posted Title");
    expect(s.key).toBe("eightfold:h.example:790319186617");
  });

  it("recognises US postings by any listed location and rejects the rest", () => {
    expect(eightfoldInUS({ locations: ["Los Angeles,California,United States of America"] })).toBe(true);
    expect(eightfoldInUS({ standardizedLocations: ["Reno, NV, US"] })).toBe(true);
    expect(eightfoldInUS({ locations: ["London, United Kingdom", "Austin, TX, USA"] })).toBe(true);
    expect(eightfoldInUS({ location: "Remote, United States" })).toBe(true);
    expect(eightfoldInUS({ locations: ["Bangalore, KA, IN"] })).toBe(false);
    expect(eightfoldInUS({ locations: ["Sydney, Australia"] })).toBe(false);
    expect(eightfoldInUS({ locations: ["Brussels, Belgium (US Embassy liaison)"] })).toBe(false);
    expect(eightfoldInUS({})).toBe(false);
  });

  it("does not take other sites' /careers/job/ paths of a short id for an Eightfold key", () => {
    expect(jobKey("https://example.com/careers/job/42")).toBe("url:https://example.com/careers/job/42");
  });
});

describe("Eightfold registry and watchlist", () => {
  it("has the channel, a live registry row and watchlist tenants with unique hosts", () => {
    expect(OFFICIAL_CHANNELS).toContain("official_eightfold");
    expect(SOURCE_REGISTRY.find((r) => r.id === "official_eightfold")?.status).toBe("live");
    const w = loadWatchlist();
    expect(w.eightfold.map((e) => e.company)).toEqual(expect.arrayContaining(["Netflix", "Eaton"]));
    const hosts = w.eightfold.map((e) => e.host.toLowerCase());
    expect(new Set(hosts).size).toBe(hosts.length);
    expect(w.eightfold.find((e) => e.company === "Eaton")?.api).toBe("pcsx");
  });
});

describe("watchlist coverage-miss resolutions (2026-11-02)", () => {
  const raw = readFileSync(join(import.meta.dirname, "../config/watchlist.yaml"), "utf8");
  const w = loadWatchlist();

  it("lists aggregators, including Military Spouse Jobs, and none of them as a watched employer", () => {
    expect(w.aggregators).toContain("Military Spouse Jobs");
    const watched = new Set([...w.greenhouse, ...w.lever, ...w.ashby, ...w.workday, ...w.smartrecruiters, ...w.oracleHcm, ...w.eightfold].map((b) => b.company.toLowerCase()));
    for (const a of w.aggregators) expect(watched.has(a.toLowerCase()), a).toBe(false);
  });

  it("keeps no company both pending and on a live board, and gives every pending row a reason when it is not a plain unknown", () => {
    const pending = (raw.split("\npending:\n")[1] ?? "").split("\n\n")[0]!.split("\n").map((l) => /company: '([^']*)'/.exec(l)?.[1]).filter((x): x is string => Boolean(x));
    const live = new Set([...w.greenhouse, ...w.lever, ...w.ashby, ...w.workday, ...w.smartrecruiters, ...w.oracleHcm, ...w.eightfold].map((b) => b.company.toLowerCase().trim()));
    for (const c of pending) expect(live.has(c.toLowerCase().trim()), c).toBe(false);
    for (const name of ["Honda", "Capgemini", "L.E.K.", "Stamp", "Sixtyfour", "Concord", "B4Corp", "Torentify", "Omnicom"]) {
      const row = raw.split("\n").find((l) => l.includes(`company: '`) && l.includes(name) && l.includes("reason:"));
      expect(row, name).toBeTruthy();
    }
  });

  it("reads the boards added for the coverage misses", () => {
    expect(w.greenhouse.some((b) => b.board === "smxtech")).toBe(true);
    expect(w.workday.some((s) => s.site === "https://aptos.wd108.myworkdayjobs.com/Revionics")).toBe(true);
    expect(w.workday.some((s) => s.site.toLowerCase() === "https://gdit.wd5.myworkdayjobs.com/external_career_site")).toBe(true);
    expect(w.amazon?.queries).toContain("Annapurna Labs");
  });
});
