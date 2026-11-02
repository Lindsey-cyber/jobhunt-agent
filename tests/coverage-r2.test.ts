import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { boardOf, causeOf, fits, indexCatalog, liveness, match, normCompany, parseListTable, sampleOf, type SampleRow, type WatchedBoard } from "../src/discover/coverage.ts";
import type { Job, JobKey } from "../src/domain/job.ts";
import { followRedirects, resolveLinks } from "../src/sources/coverage.ts";
import { inScopeTitle as IN_SCOPE_TITLE_FN } from "../src/discover/triage.ts";
import { fetchWorkday } from "../src/sources/fetch.ts";
const IN_SCOPE_TITLE = { test: IN_SCOPE_TITLE_FN };

const job = (o: Partial<Job> & Pick<Job, "key" | "company" | "title">): Job =>
  ({ location: "Remote, US", url: `https://x.test/${o.key}`, official: false, publishedAt: "", description: "", sources: [], firstSeen: "", lastSeen: "", triage: { verdict: "match", rule: "role.match", reason: "" }, hints: {}, size: "unknown", ...o }) as Job;
const row = (company: string, title: string, o: Partial<SampleRow> = {}): SampleRow => ({ company, title, location: "Austin, TX", date: "Nov 01", list: "L", ...o });
const NOW = new Date("2026-11-02T12:00:00Z");
const POLICY = { excludeCompanies: [], excludeTitles: [], excludeSeniorTitles: true };

afterEach(() => vi.unstubAllGlobals());

describe("company names", () => {
  // Only legal-form words go, and only from the end; a parenthetical goes; everything else is part of the name.
  it.each([
    ["Acme, LLC", "Acme"],
    ["Acme Corporation", "Acme"],
    ["Acme Corp.", "ACME"],
    ["Acme Ltd.", "acme"],
    ["Acme GmbH", "acme"],
    ["Acme PLC", "Acme"],
    ["Acme LP", "Acme"],
    ["Acme LLP", "Acme"],
    ["Acme Co", "Acme"],
    ["Acme, Inc.", "Acme Inc"],
    ["Sixtyfour (X25)", "Sixtyfour"],
    ["L.E.K. Consulting", "LEK Consulting"],
    ["AT&T", "AT & T"],
  ])("%s is %s", (a, b) => expect(normCompany(a)).toBe(normCompany(b)));

  it("keeps meaningful words: 'General Motors' is not 'General', 'Bank of America' is not 'Bank of'", () => {
    expect(normCompany("General Motors")).toBe("general motors");
    expect(normCompany("General")).toBe("general");
    expect(normCompany("General Motors")).not.toBe(normCompany("General"));
    expect(normCompany("Bank of America")).toBe("bank of america");
    expect(normCompany("Bank of America")).not.toBe(normCompany("Bank of"));
    expect(normCompany("American Honda Motor Company, Inc.")).toBe("american honda motor company");
    expect(normCompany("American Honda Motor Company, Inc.")).not.toBe(normCompany("American Honda"));
    expect(normCompany("Omnicom Group")).not.toBe(normCompany("Omnicom"));
    expect(normCompany("Global Group")).toBe("global group");
    expect(normCompany("Group")).toBe("group");
    expect(normCompany("Capital One")).not.toBe(normCompany("Capital Group"));
    expect(normCompany("")).toBe("");
  });

  it("a catalog row under 'Omnicom Group' does not answer a list row for 'Omnicom': a different company name is a miss, not a guess", () => {
    const idx = indexCatalog([job({ key: "workday:interpublic:r1" as JobKey, company: "Omnicom Group", title: "Data Science and Analytics" })]);
    expect(match(row("Omnicom", "Data Science and Analytics"), idx)).toBeUndefined();
    expect(match(row("Omnicom Group", "Data Science and Analytics"), idx)?.how).toBe("title");
  });
});

describe("rows the list marks closed", () => {
  const md = [
    "| Company | Role | Location | Application/Link | Date Posted |",
    "| --- | --- | --- | :---: | :---: |",
    '| **NVIDIA** | New Grad 2026: AI Infra Engineer | Santa Clara, CA | 🔒 | Nov 01 |',
    '| **NVIDIA** | New Grad 2026: AI Infra Engineer | Santa Clara, CA | <a href="https://go.vansh.nyc/1?s=A"><img alt="Apply"></a> | Nov 01 |',
  ].join("\n");
  const rows = parseListTable("L", md);
  it("marks 🔒 rows closed and leaves link rows open", () => {
    expect(rows[0]).toMatchObject({ closed: true, url: undefined });
    expect(rows[1]!.closed).toBeUndefined();
    expect(rows[1]!.url).toBe("https://go.vansh.nyc/1?s=A");
  });
  it("a closed row is not a fitting posting, so it cannot shadow its open duplicate in the sample", () => {
    const fit = rows.filter((r) => fits(r, POLICY, NOW));
    expect(fit).toHaveLength(1);
    expect(sampleOf(fit, 10)[0]!.url).toBe("https://go.vansh.nyc/1?s=A");
  });
});

describe("liveness: a known id gone from a complete board", () => {
  const gh = (titles: string[], keys: string[]): WatchedBoard => ({ ats: "greenhouse", titles, keys });
  const link = (id: number) => `https://about.nextdoor.com/careers-list/?gh_jid=${id}`;
  it("a near title does not keep the entry live (Nextdoor's real case)", () => {
    const r = row("Nextdoor", "New Grad 2026: Machine Learning Engineer, Machine Learning", { url: link(7264954) });
    expect(liveness(r, [gh(["Machine Learning Engineer - Ads"], ["greenhouse:6005888"])])).toBe("not_listed");
  });
  it("the identical title still does: a repost under a new id", () => {
    const r = row("Nextdoor", "Machine Learning Engineer - Ads", { url: link(7264954) });
    expect(liveness(r, [gh(["Machine Learning Engineer - Ads"], ["greenhouse:6005888"])])).toBe("live");
  });
  it("the id on the board wins over any title", () => {
    expect(liveness(row("Nextdoor", "Renamed", { url: link(1) }), [gh(["Other"], ["greenhouse:1"])])).toBe("live");
  });
  it("on a board that was not read in full, a near title proves live and nothing proves gone", () => {
    const r = row("Nextdoor", "Machine Learning Engineer, Machine Learning", { url: link(7264954) });
    expect(liveness(r, [{ ats: "greenhouse", titles: ["Machine Learning Engineer - Ads"], keys: ["greenhouse:6005888"], partial: true }])).toBe("live");
    expect(liveness(row("Nextdoor", "Chef", { url: link(7264954) }), [{ ats: "greenhouse", titles: ["Cook"], keys: [], partial: true }])).toBe("unknown");
  });
});

describe("liveness: only the exact board the link names can prove a posting gone", () => {
  // Astera Labs posts early-career roles on its own Greenhouse board, asteraearlycareer2027, not on asteralabs.
  const link = "https://job-boards.greenhouse.io/asteraearlycareer2027/jobs/4731594005";
  const astera = row("Astera Labs", "Machine Learning Engineer, Early Career 2027", { url: link });
  const main: WatchedBoard = { ats: "greenhouse", board: "asteralabs", titles: ["Chef"], keys: ["greenhouse:1"], partial: false };
  const early: WatchedBoard = { ats: "greenhouse", board: "asteraearlycareer2027", titles: ["Chef"], keys: ["greenhouse:2"], partial: false };

  it("the link's board names the slug", () => {
    expect(boardOf(link)).toBe("asteraearlycareer2027");
    expect(boardOf("https://jobs.lever.co/Acme/0d1b1f1e-1111-4222-8333-944444444444")).toBe("acme");
    expect(boardOf("https://jobright.ai/jobs/info/1")).toBeUndefined();
  });
  it("another complete board of the same company does not prove the posting gone: unknown, so a miss", () => {
    expect(liveness(astera, [main])).toBe("unknown");
    expect(causeOf(astera, undefined, indexCatalog([]), [main])).toBe("watched company, posting not fetched (greenhouse)");
  });
  it("the link's own board, read in full without the id, does prove it gone", () => {
    expect(liveness(astera, [main, early])).toBe("not_listed");
  });
  it("the link's own board not read in full keeps it unknown, whatever the other boards say", () => {
    expect(liveness(astera, [main, { ...early, partial: true }])).toBe("unknown");
  });
});

describe("following list links", () => {
  const GH = "https://job-boards.greenhouse.io/acme/jobs/12345";
  const WD = "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Security-Architect_JR2026387-1";
  // Each URL maps to [status, location]; unknown URLs are 200. Records every request.
  const web = (map: Record<string, [number, string?]>, opts: { noHead?: boolean } = {}) => {
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      if (opts.noHead && method === "HEAD") return new Response(null, { status: 405 });
      const [status, location] = map[url] ?? [200];
      return new Response(null, { status, headers: location ? { location } : {} });
    }));
    return calls;
  };
  const cachePath = () => join(mkdtempSync(join(tmpdir(), "cov-")), "links.json");
  const opts = () => ({ cachePath: cachePath(), hostGapMs: 0 });

  it("follows a redirector to the ATS url and never requests the ATS page itself", async () => {
    const calls = web({ "https://go.x.test/a": [302, WD] });
    const [r] = await resolveLinks([row("NVIDIA", "T", { url: "https://go.x.test/a" })], opts());
    expect(r!.url).toBe(WD);
    expect(calls).toEqual([{ url: "https://go.x.test/a", method: "HEAD" }]);
  });
  it("follows a chain of hops, resolving relative locations", async () => {
    web({ "https://a.test/1": [301, "/2"], "https://a.test/2": [302, GH] });
    expect(await followRedirects("https://a.test/1")).toBe(GH);
  });
  it("stops at the employer's own page when it is not a redirect", async () => {
    web({ "https://a.test/1": [302, "https://careers.acme.test/jobs/9"] });
    expect(await followRedirects("https://a.test/1")).toBe("https://careers.acme.test/jobs/9");
  });
  it("only ever sends HEAD, or GET when HEAD is refused, and never follows automatically", async () => {
    const calls = web({ "https://a.test/1": [302, GH] }, { noHead: true });
    expect(await followRedirects("https://a.test/1")).toBe(GH);
    expect(calls.map((c) => c.method)).toEqual(["HEAD", "GET"]);
  });
  it("leaves links that already name an ATS posting, and rows without a link, untouched with no request", async () => {
    const calls = web({});
    const rows = [row("A", "T", { url: GH }), row("B", "T"), row("C", "T", { url: "mailto:x@y.z" })];
    expect(await resolveLinks(rows, opts())).toEqual(rows);
    expect(calls).toHaveLength(0);
  });
  it("does not pass a bot-check or login wall (jobright's challenge)", async () => {
    web({ "https://jobright.ai/jobs/info/1": [303, "/_jr/security/challenge?return=%2Fjobs%2Finfo%2F1"] });
    const r = row("BNY", "T", { url: "https://jobright.ai/jobs/info/1" });
    expect(await resolveLinks([r], opts())).toEqual([r]);
    web({ "https://a.test/1": [302, "https://sso.acme.test/login?next=x"] });
    expect(await followRedirects("https://a.test/1")).toBeUndefined();
  });
  it("survives a loop, a hop limit, a missing Location and a network error", async () => {
    web({ "https://a.test/1": [302, "https://a.test/2"], "https://a.test/2": [302, "https://a.test/1"] });
    expect(await followRedirects("https://a.test/1")).toBe("https://a.test/2");
    web(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`https://h.test/${i}`, [302, `https://h.test/${i + 1}`] as [number, string]])));
    expect(await followRedirects("https://h.test/0")).toBe("https://h.test/6");
    web({ "https://a.test/1": [302] });
    expect(await followRedirects("https://a.test/1")).toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await followRedirects("https://a.test/1")).toBeUndefined();
  });
  it("asks once per distinct link and remembers the answer on disk for the next run", async () => {
    const calls = web({ "https://go.x.test/a": [302, GH] });
    const o = opts();
    const rows = [row("A", "T1", { url: "https://go.x.test/a" }), row("A", "T2", { url: "https://go.x.test/a" })];
    expect((await resolveLinks(rows, o)).map((r) => r.url)).toEqual([GH, GH]);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(readFileSync(o.cachePath, "utf8"))).toEqual({ "https://go.x.test/a": GH });
    const again = web({});
    expect((await resolveLinks(rows, o))[0]!.url).toBe(GH);
    expect(again).toHaveLength(0);
  });
  it("a resolved link gives the row its JobKey, so matching and the stale check use the posting's own id", async () => {
    web({ "https://go.x.test/a": [302, WD] });
    const [r] = await resolveLinks([row("NVIDIA", "Security Architect", { url: "https://go.x.test/a" })], opts());
    const idx = indexCatalog([job({ key: "workday:nvidia:jr2026387-1" as JobKey, company: "NVIDIA", title: "Something else", official: true })]);
    expect(match(r!, idx)?.how).toBe("key");
    const board: WatchedBoard = { ats: "workday", site: "nvidia/nvidiaexternalcareersite", titles: ["Chef"], keys: ["workday:nvidia:jr1"], partial: false };
    expect(liveness(r!, [board])).toBe("not_listed");
  });
  it("does not remember a chain that ended in a 5xx: it is used for this run and asked again next run", async () => {
    web({ "https://go.x.test/a": [302, "https://a.test/2"], "https://a.test/2": [503] });
    const o = opts();
    const rows = [row("A", "T", { url: "https://go.x.test/a" })];
    expect((await resolveLinks(rows, o))[0]!.url).toBe("https://a.test/2");
    expect(existsSync(o.cachePath)).toBe(false);
    const again = web({ "https://go.x.test/a": [302, GH] });
    expect((await resolveLinks(rows, o))[0]!.url).toBe(GH);
    expect(again).toHaveLength(1);
  });
  it("does not remember a chain that ended in a network error or a 429", async () => {
    for (const end of ["down", 429] as const) {
      vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        if (String(url) === "https://go.x.test/a") return new Response(null, { status: 302, headers: { location: "https://a.test/2" } });
        if (end === "down") throw new Error("down");
        return new Response(null, { status: 429 });
      }));
      const o = opts();
      await resolveLinks([row("A", "T", { url: "https://go.x.test/a" })], o);
      expect(existsSync(o.cachePath)).toBe(false);
    }
  });
  it("remembers a complete chain that ended at the employer's own page", async () => {
    web({ "https://go.x.test/a": [302, "https://careers.acme.test/jobs/9"] });
    const o = opts();
    await resolveLinks([row("A", "T", { url: "https://go.x.test/a" })], o);
    expect(JSON.parse(readFileSync(o.cachePath, "utf8"))).toEqual({ "https://go.x.test/a": "https://careers.acme.test/jobs/9" });
  });
});

describe("Workday detail fetch covers the roles she put in scope", () => {
  it.each(["Data Scientist", "GE Vernova Data Scientist", "University - Data Scientist", "Biostatistician I", "Statistical Analyst", "AI Data Analyst", "Machine Learning Analyst"])("reads %s", (t) => expect(IN_SCOPE_TITLE.test(t)).toBe(true));
  it.each(["Account Executive", "Financial Analyst", "Data Entry Clerk", "Scientist, Chemistry"])("skips %s", (t) => expect(IN_SCOPE_TITLE.test(t)).toBe(false));
  it("still reads everything the AI/ML pattern read", () => expect(IN_SCOPE_TITLE.test("Deep Learning Engineer")).toBe(true));

  it("a listed Data Scientist reaches the sightings, an Account Executive does not", async () => {
    const posts = [["Data Scientist", "/job/x/DS-1"], ["Account Executive", "/job/x/AE-2"]] as const;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify({ total: 2, jobPostings: posts.map(([title, externalPath]) => ({ title, externalPath, postedOn: "Posted Today" })) }));
      const p = posts.find(([, path]) => String(url).endsWith(path))!;
      return new Response(JSON.stringify({ jobPostingInfo: { title: p[0], jobDescription: "x", location: "Remote", externalUrl: `https://acme.wd5.myworkdayjobs.com/Careers${p[1]}`, country: { descriptor: "United States of America" } } }));
    }));
    const r = await fetchWorkday({ site: "https://acme.wd5.myworkdayjobs.com/Careers", company: "Acme", size: "medium_large" }, [], "2026-11-02T12:00:00.000Z");
    expect(r.sightings.map((s) => s.title)).toEqual(["Data Scientist"]);
    expect(r.outcome.listed).toBe(2);
  });
});
