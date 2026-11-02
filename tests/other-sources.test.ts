import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAmazon, parseOracleHcm, parseSmartRecruiters, type OracleHcmDetail, type OracleHcmItem, type SmartRecruitersDetail, type SmartRecruitersItem } from "../src/discover/parse.ts";
import { OFFICIAL_CHANNELS } from "../src/domain/job.ts";
import { SOURCE_REGISTRY } from "../src/discover/sources.ts";
import { loadWatchlist } from "../src/sources/fetch.ts";

const fx = <T>(name: string): T => JSON.parse(readFileSync(join(import.meta.dirname, "../fixtures/sources", name), "utf8")) as T;
const SEEN = "2026-11-02T12:00:00.000Z";

describe("SmartRecruiters (saved ServiceNow response, 2026-11-02)", () => {
  const list = fx<{ content: SmartRecruitersItem[] }>("smartrecruiters-servicenow-list.json");
  const detail = fx<SmartRecruitersDetail>("smartrecruiters-servicenow-detail.json");

  it("turns a list item into an official sighting with the employer's release date", () => {
    const s = parseSmartRecruiters(list.content[0]!, "ServiceNow", "ServiceNow", SEEN)!;
    expect(s.channel).toBe("official_smartrecruiters");
    expect(s.official).toBe(true);
    expect(s.title).toBe(list.content[0]!.name.trim());
    expect(s.date).toBe(new Date(list.content[0]!.releasedDate!).toISOString());
    expect(s.dateKind).toBe("published");
    expect(s.location).toContain("United States");
  });

  it("reads the posting URL and the description sections from the detail", () => {
    const s = parseSmartRecruiters(detail, "ServiceNow", "ServiceNow", SEEN)!;
    expect(s.url).toBe("https://jobs.smartrecruiters.com/ServiceNow/744000159054169-senior-content-designer");
    expect(s.key).toBe("smartrecruiters:744000159054169");
    expect(s.description.length).toBeGreaterThan(200);
    expect(s.description).not.toMatch(/<[a-z]+>/);
  });

  it("skips an item with no id or title", () => {
    expect(parseSmartRecruiters({ id: "", name: "x" }, "A", "A", SEEN)).toBeUndefined();
  });
});

describe("Oracle HCM (saved American Express response, 2026-11-02)", () => {
  const list = fx<{ items: { requisitionList: OracleHcmItem[] }[] }>("oracle-hcm-amex-list.json").items[0]!.requisitionList;
  const detail = fx<{ items: OracleHcmDetail[] }>("oracle-hcm-amex-detail.json").items[0]!;

  it("turns a list row into an official sighting with the posted day and the public job URL", () => {
    const s = parseOracleHcm(list[0]!, "egug.fa.us2.oraclecloud.com", "CX_1", "American Express", SEEN)!;
    expect(s.channel).toBe("official_oracle_hcm");
    expect(s.url).toBe(`https://egug.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/${list[0]!.Id}`);
    expect(s.date).toBe(`${list[0]!.PostedDate}T00:00:00.000Z`);
    expect(s.dateKind).toBe("published");
    expect(s.location).toContain(list[0]!.PrimaryLocation!);
  });

  it("prefers the detail's exact timestamp and fills the description", () => {
    const s = parseOracleHcm({ ...list[0]!, ...detail }, "egug.fa.us2.oraclecloud.com", "CX_1", "American Express", SEEN)!;
    expect(s.date).toBe(new Date(detail.ExternalPostedStartDate!).toISOString());
    expect(s.description).toContain("Experimentation");
    expect(s.description).not.toMatch(/<(p|li|ul)[ >]/);
  });
});

describe("Amazon (amazon.jobs search.json shape)", () => {
  const body = {
    jobs: [
      { id_icims: "10591841", title: " Senior Machine Learning Engineer, SageMaker Inference ", job_path: "/en/jobs/10591841/senior-machine-learning-engineer-sagemaker-inference", posted_date: "October 28, 2026", normalized_location: "Bellevue, Washington, USA", description: "Build <b>ML</b> systems.", basic_qualifications: "- 5+ years<br/>- Bachelor's", preferred_qualifications: "- PhD", job_schedule_type: "full-time" },
      { title: "no path" },
    ],
  };
  it("parses the posted date as a UTC day, builds the URL and drops rows without a path", () => {
    const s = parseAmazon(body, SEEN);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ channel: "official_amazon", company: "Amazon", title: "Senior Machine Learning Engineer, SageMaker Inference", date: "2026-10-28T00:00:00.000Z", dateKind: "published", url: "https://www.amazon.jobs/en/jobs/10591841/senior-machine-learning-engineer-sagemaker-inference" });
    expect(s[0]!.description).toContain("5+ years");
  });
});

describe("registry and watchlist for the new sources", () => {
  it("counts the new channels as official", () => {
    for (const c of ["official_smartrecruiters", "official_oracle_hcm", "official_amazon"] as const) expect(OFFICIAL_CHANNELS).toContain(c);
  });

  it("has a written reason on every deferred row and none left not_built", () => {
    for (const r of SOURCE_REGISTRY) {
      expect(r.status, r.id).not.toBe("not_built");
      if (r.status === "deferred") expect((r.reason ?? "").length, r.id).toBeGreaterThan(20);
    }
  });

  it("lists SmartRecruiters and Oracle HCM entries that the fetchers can read, with unique ids", () => {
    const w = loadWatchlist();
    expect(w.smartrecruiters.length).toBeGreaterThan(0);
    expect(w.oracleHcm.length).toBeGreaterThan(0);
    const ids = w.smartrecruiters.map((c) => c.id.toLowerCase());
    expect(new Set(ids).size).toBe(ids.length);
    const sites = w.oracleHcm.map((o) => `${o.host}/${o.site}`.toLowerCase());
    expect(new Set(sites).size).toBe(sites.length);
    expect(w.amazon?.queries.length).toBeGreaterThan(0);
  });
});
