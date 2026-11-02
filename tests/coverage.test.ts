import { describe, expect, it } from "vitest";
import { causeOf, fits, indexCatalog, liveness, match, MIN_N, notIndependent, parseListTable, readInFull, report, resampleRows, sampleOf, summarize, urlsIn, workdaySite, type Judged, type SampleRow, type WatchedBoard } from "../src/discover/coverage.ts";
import type { Job, JobKey } from "../src/domain/job.ts";
import { requireIndependent, type SampleList } from "../src/sources/coverage.ts";

const job = (o: Partial<Job> & Pick<Job, "key" | "company" | "title">): Job =>
  ({ location: "Remote, US", url: `https://x.test/${o.key}`, official: false, publishedAt: "", description: "", sources: [], firstSeen: "", lastSeen: "", triage: { verdict: "match", rule: "role.match", reason: "" }, hints: {}, size: "unknown", ...o }) as Job;
const row = (company: string, title: string, o: Partial<SampleRow> = {}): SampleRow => ({ company, title, location: "Austin, TX", date: "Nov 01", list: "L", ...o });
const NOW = new Date("2026-11-02T12:00:00Z");
const POLICY = { excludeCompanies: ["Google"], excludeTitles: ["analytics engineer"], excludeSeniorTitles: true };

describe("independence", () => {
  const watch = urlsIn("- { name: SimplifyJobs/New-Grad-Positions, url: 'https://github.com/SimplifyJobs/New-Grad-Positions', raw: 'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/x.json' }");
  it("refuses a source whose repo the watchlist fetches, in any URL form", () => {
    expect(notIndependent(["https://raw.githubusercontent.com/simplifyjobs/new-grad-positions/main/README.md"], watch)).toHaveLength(1);
    expect(notIndependent(["https://github.com/SimplifyJobs/New-Grad-Positions"], watch)).toHaveLength(1);
  });
  it("accepts a different repo by the same owner", () => {
    expect(notIndependent(["https://github.com/SimplifyJobs/Other"], watch)).toEqual([]);
  });
});

describe("list parsing and the sample filter", () => {
  const md = [
    "| Company | Job Title | Location | Work Model | Date Posted |",
    "| --- | --- | --- | --- | --- |",
    "| **[Acme](https://acme.test)** | **[ML Engineer, New Grad](https://jobright.ai/jobs/info/1?utm=1)** | Austin, TX, United States | Hybrid | Nov 01 |",
    "| ↳ | **[Data Scientist I](https://jobright.ai/jobs/info/2)** | Remote, United States | Remote | Sep 01 |",
    "| Beta | Software Engineer | NY | x | Nov 01 |",
  ].join("\n");
  const rows = parseListTable("L", md);
  it("reads company, title, location, link and date, carrying a company over a ↳ row", () => {
    expect(rows[0]).toMatchObject({ company: "Acme", title: "ML Engineer, New Grad", date: "Nov 01", url: "https://jobright.ai/jobs/info/1?utm=1" });
    expect(rows[1]!.company).toBe("Acme");
  });
  it("keeps only fresh, US, ML-titled, policy-clean postings", () => {
    expect(fits(rows[0]!, POLICY, NOW)).toBe(true);
    expect(fits(rows[1]!, POLICY, NOW)).toBe(false); // 62 days old
    expect(fits(rows[2]!, POLICY, NOW)).toBe(false); // not an ML title
    expect(fits(row("Google DeepMind", "ML Engineer"), POLICY, NOW)).toBe(false); // excluded company
    expect(fits(row("Acme", "Senior ML Engineer"), POLICY, NOW)).toBe(false);
    expect(fits(row("Acme", "Analytics Engineer, ML"), POLICY, NOW)).toBe(false);
    expect(fits(row("Acme", "ML Engineer", { location: "London, United Kingdom" }), POLICY, NOW)).toBe(false);
  });
  it("de-duplicates and caps deterministically", () => {
    const many = Array.from({ length: 10 }, (_, i) => row(`C${i}`, "ML Engineer"));
    expect(sampleOf([...many, many[0]!], 100)).toHaveLength(10);
    expect(sampleOf(many, 4)).toHaveLength(4);
    expect(sampleOf(many, 4)).toEqual(sampleOf([...many].reverse(), 4));
  });
});

describe("matching", () => {
  const gh = job({ key: "greenhouse:123" as JobKey, company: "Acme Inc.", title: "Machine Learning Engineer (New Grad 2027)", official: true });
  const idx = indexCatalog([gh, job({ key: "url:https://x.test/senior" as JobKey, company: "Beta", title: "Senior ML Engineer" })]);
  it("matches by JobKey when the list gives an ATS URL, even if the title differs", () => {
    expect(match(row("Other name", "Totally different", { url: "https://boards.greenhouse.io/acme/jobs/123?gh_src=x" }), idx)).toMatchObject({ how: "key" });
  });
  it("matches by normalized company and title, and by a near title", () => {
    expect(match(row("Acme", "Machine Learning Engineer"), idx)).toMatchObject({ how: "title" });
    expect(match(row("ACME", "Machine Learning Engineer II"), idx)?.how).toBe("fuzzy");
    expect(match(row("Acme", "Data Engineer"), idx)).toBeUndefined();
  });
  it("never counts a senior catalog row as the entry-level posting", () => {
    expect(match(row("Beta", "ML Engineer"), idx)).toBeUndefined();
  });
  it("a row whose ATS URL names a posting not in the catalog is a miss, even with the same company and title", () => {
    const other = indexCatalog([job({ key: "greenhouse:999" as JobKey, company: "Acme", title: "ML Engineer", official: true })]);
    const r = row("Acme", "ML Engineer", { url: "https://boards.greenhouse.io/acme/jobs/123" });
    expect(match(r, other)).toBeUndefined();
    expect(causeOf(r, undefined, other, [])).toBe("watched company, posting not fetched (greenhouse)");
  });
});

describe("causes", () => {
  const idx = indexCatalog([
    job({ key: "greenhouse:1" as JobKey, company: "Acme", title: "ML Engineer", official: true }),
    job({ key: "greenhouse:2" as JobKey, company: "Acme", title: "Data Scientist", triage: { verdict: "reject", rule: "role.non_engineering", reason: "" } }),
  ]);
  const cause = (r: SampleRow, boards = [] as Parameters<typeof causeOf>[3]) => causeOf(r, match(r, idx), idx, boards);
  it("is undefined for a posting that is in the catalog and not rejected", () => {
    expect(cause(row("Acme", "ML Engineer"))).toBeUndefined();
  });
  it("names the triage rule for a posting the rules rejected", () => {
    expect(cause(row("Acme", "Data Scientist"))).toBe("filtered by triage rule role.non_engineering");
  });
  it("says the company is not on the watchlist", () => {
    expect(cause(row("Nobody", "ML Engineer"))).toBe("company not on watchlist");
  });
  it("names the ATS when a watched company's posting was not fetched", () => {
    expect(cause(row("Acme", "Vision Engineer"), [{ ats: "workday" }])).toBe("watched company, posting not fetched (workday/greenhouse)");
    expect(cause(row("Acme", "Vision Engineer"), [{ ats: "greenhouse", titles: ["Vision Engineer"] }])).toBe("watched company, posting not fetched (greenhouse)");
  });
  it("calls a list entry stale only when its own id is missing from a complete board of its ATS", () => {
    const withId = row("Acme", "Vision Engineer", { url: "https://job-boards.greenhouse.io/acme/jobs/999" });
    expect(cause(withId, [{ ats: "greenhouse", titles: ["Chef"], keys: ["greenhouse:123"] }])).toMatch(/^stale list entry/);
  });
  it("never calls a list entry stale on its title alone, however the board reads", () => {
    expect(cause(row("Acme", "Vision Engineer"), [{ ats: "greenhouse", titles: ["Chef"], keys: [] }])).not.toMatch(/^stale/);
  });
  it("does not call it stale when one of the company's boards cannot be checked", () => {
    expect(cause(row("Acme", "Vision Engineer"), [{ ats: "greenhouse", titles: ["Chef"] }, { ats: "workday" }])).toMatch(/^watched company/);
  });
});

describe("the coverage file", () => {
  const idx = indexCatalog([
    job({ key: "greenhouse:1" as JobKey, company: "Acme", title: "ML Engineer" }),
    job({ key: "greenhouse:2" as JobKey, company: "Acme", title: "Data Scientist", triage: { verdict: "reject", rule: "role.non_engineering", reason: "" } }),
  ]);
  const judged: Judged[] = [row("Acme", "ML Engineer"), row("Acme", "Data Scientist"), row("Nobody", "AI Engineer", { url: "https://n.test/j" })].map((r) => {
    const found = match(r, idx);
    return { row: r, found, cause: causeOf(r, found, idx, []) };
  });
  const r = report("2026-11-02", ["L"], judged);
  it("has exactly the tracker's fields and counts", () => {
    expect(Object.keys(r).sort()).toEqual(["date", "inCatalog", "inCatalogNotRejected", "misses", "n", "sources", "stale", "staleExcluded"]);
    expect([r.n, r.inCatalog, r.inCatalogNotRejected]).toEqual([3, 2, 1]);
    expect(r.misses.map((m) => Object.keys(m).sort())).toEqual([["cause", "company", "title", "url"], ["cause", "company", "title", "url"]]);
    expect(r.misses[1]).toMatchObject({ company: "Nobody", url: "https://n.test/j", cause: "company not on watchlist" });
  });
  it("summarizes in one paragraph", () => {
    expect(summarize(r)).toContain("2/3 sampled postings are in the catalog");
  });
});

describe("independence check before fetching", () => {
  const list = (name: string, url: string, raw: string): SampleList => ({ name, url, raw });
  const watch = urlsIn("- { name: SimplifyJobs/New-Grad-Positions, url: 'https://github.com/SimplifyJobs/New-Grad-Positions', raw: 'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/x.json' }");
  it("refuses a sample list whose repo appears in the watchlist text", () => {
    const same = list("SimplifyJobs/New-Grad-Positions", "https://github.com/SimplifyJobs/New-Grad-Positions", "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/main/README.md");
    expect(() => requireIndependent([same], watch)).toThrow(/refused: SimplifyJobs\/New-Grad-Positions/);
  });
  it("passes when no sample list's repo is in the watchlist", () => {
    const other = list("vanshb03/New-Grad-2027", "https://github.com/vanshb03/New-Grad-2027", "https://raw.githubusercontent.com/vanshb03/New-Grad-2027/dev/README.md");
    expect(() => requireIndependent([other], watch)).not.toThrow();
  });
});

describe("stale list entries", () => {
  const board = (ats: string, o: Partial<WatchedBoard> = {}): WatchedBoard => ({ ats, titles: ["Chef"], keys: [], ...o });
  const ghRow = (id: number, title = "Vision Engineer") => row("Acme", title, { url: `https://job-boards.greenhouse.io/acme/jobs/${id}` });
  const wdSite = "nvidia/nvidiaexternalcareersite";
  const wdUrl = "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Deep-Learning-Engineer_JR2028177";
  const wdRow = row("NVIDIA", "Deep Learning Engineer", { url: wdUrl });
  const wdBoard = (titles: string[], keys: string[], o: Partial<WatchedBoard> = {}): WatchedBoard => ({ ats: "workday", titles, keys, site: wdSite, ...o });

  describe("liveness", () => {
    it("live by title, when the board lists the title and the id is absent", () => {
      expect(liveness(row("NVIDIA", "New Grad 2026: Deep Learning Engineer"), [wdBoard(["Deep Learning Engineer - New College Grad 2027"], [])])).toBe("live");
    });
    it("live by id, whatever the title", () => {
      expect(liveness(ghRow(123, "Old name"), [board("greenhouse", { titles: ["New name"], keys: ["greenhouse:123"] })])).toBe("live");
    });
    it("live by Workday requisition in the link", () => {
      expect(liveness(wdRow, [wdBoard([], ["workday:nvidia:jr2028177"])])).toBe("live");
    });
    it("not listed only when the id is absent from a complete board of its ATS", () => {
      expect(liveness(ghRow(999), [board("greenhouse", { keys: ["greenhouse:123"] })])).toBe("not_listed");
      expect(liveness(wdRow, [wdBoard(["Chef"], ["workday:nvidia:jr1"])])).toBe("not_listed");
    });
    it("no id in the link means unknown, even when no title on any complete board matches", () => {
      expect(liveness(row("NVIDIA", "Vision Engineer"), [wdBoard(["Chef"], ["workday:nvidia:jr1"])])).toBe("unknown");
      expect(liveness(row("Acme", "Vision Engineer", { url: "https://jobright.ai/jobs/info/1" }), [board("greenhouse")])).toBe("unknown");
      expect(liveness(row("Acme", "Vision Engineer", { url: "" }), [board("greenhouse")])).toBe("unknown");
    });
    it("unknown when the ATS of the link has no board that was read", () => {
      expect(liveness(ghRow(999), [])).toBe("unknown");
      expect(liveness(ghRow(999), [board("lever", { keys: [] })])).toBe("unknown");
      expect(liveness(ghRow(999), [{ ats: "greenhouse" }])).toBe("unknown");
    });
    it("unknown when a board of that ATS is partial, or lists titles but no ids", () => {
      expect(liveness(ghRow(999), [board("greenhouse", { keys: [], partial: true })])).toBe("unknown");
      expect(liveness(ghRow(999), [board("greenhouse", { keys: undefined })])).toBe("unknown");
    });
    it("unknown when a board of that ATS is read but another of its boards for the company is not", () => {
      expect(liveness(ghRow(999), [board("greenhouse", { keys: ["greenhouse:1"] }), { ats: "greenhouse" }])).toBe("unknown");
    });
    it("a partial read can still prove a posting live, by title", () => {
      expect(liveness(row("NVIDIA", "Deep Learning Engineer"), [wdBoard(["Deep Learning Engineer"], [], { partial: true })])).toBe("live");
    });
    it("a Workday link is judged only against its own career site", () => {
      expect(liveness(wdRow, [wdBoard([], [], { site: "nvidia/othersite" })])).toBe("unknown");
    });
    it("readInFull needs titles, ids and no partial flag", () => {
      expect([readInFull(board("greenhouse")), readInFull({ ats: "greenhouse" }), readInFull(board("greenhouse", { partial: true }))]).toEqual([true, false, false]);
    });
    it("workdaySite names tenant and site, skipping a locale", () => {
      expect(workdaySite(wdUrl)).toBe(wdSite);
      expect(workdaySite("https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite")).toBe(wdSite);
      expect(workdaySite("https://jobs.lever.co/acme")).toBeUndefined();
    });
  });

  const judge = (rows: SampleRow[], boards: Parameters<typeof causeOf>[3]): Judged[] => rows.map((r) => ({ row: r, found: undefined, cause: causeOf(r, undefined, idx, boards) }));
  const idx = indexCatalog([]);
  it("a stale entry leaves n, is counted in staleExcluded and is not a miss; unknown stays a miss", () => {
    const greenhouse = [board("greenhouse", { keys: ["greenhouse:123"] })];
    const judged = [...judge([ghRow(999, "Vision Engineer"), ghRow(998, "Other Engineer")], greenhouse), ...judge([row("Nobody", "AI Engineer")], [])];
    const r = report("2026-11-02", ["L"], judged);
    expect(r).toMatchObject({ n: 1, inCatalog: 0, staleExcluded: 2 });
    expect(r.misses.map((m) => m.company)).toEqual(["Nobody"]);
    expect(r.stale?.map((x) => x.title)).toEqual(["Vision Engineer", "Other Engineer"]);
    expect(summarize(r)).toContain("2 stale list entries");
  });
  it("with nothing stale the count is 0 and n is unchanged", () => {
    const r = report("d", [], judge([row("Nobody", "AI Engineer")], []));
    expect([r.n, r.staleExcluded]).toEqual([1, 0]);
  });
  it("all entries stale gives n = 0 without dividing by zero", () => {
    expect(summarize(report("d", ["L"], judge([ghRow(999)], [board("greenhouse", { keys: ["greenhouse:123"] })])))).toContain("0/0");
  });

  describe("resample rule", () => {
    const pool = Array.from({ length: 80 }, (_, i) => row(`C${String(i).padStart(2, "0")}`, "ML Engineer"));
    it("adds nothing when n is already at the minimum", () => {
      expect(resampleRows(pool, pool.slice(0, 10), MIN_N)).toEqual([]);
    });
    it("adds exactly the shortfall, never a row already taken, deterministically", () => {
      const taken = pool.slice(0, 60);
      const more = resampleRows(pool, taken, 45);
      expect(more).toHaveLength(5);
      expect(more.every((m) => !taken.includes(m))).toBe(true);
      expect(resampleRows(pool, taken, 45)).toEqual(more);
    });
    it("takes all that is left when the lists run out", () => {
      expect(resampleRows(pool, pool.slice(0, 75), 10)).toHaveLength(5);
      expect(resampleRows(pool, pool, 10)).toEqual([]);
    });
    it("does not re-add a posting taken under a different year in its title", () => {
      expect(resampleRows([row("A", "ML Engineer 2026")], [row("A", "ML Engineer 2027")], 0)).toEqual([]);
    });
  });
});
