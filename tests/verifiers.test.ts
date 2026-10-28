import { describe, expect, it } from "vitest";
import type { Job, JobKey } from "../src/domain/job.ts";
import { drawSample, scoreAudit, type AnswerKeyItem } from "../src/discover/audit.ts";
import { outreachQueue } from "../src/discover/outreach.ts";
import { initialStage, recordAudit } from "../src/discover/stagetrust.ts";
import { makeUserData } from "./helpers.ts";

const T0 = "2026-10-28T00:00:00.000Z";
const job = (i: number, verdict: Job["triage"]["verdict"], over: Partial<Job> = {}): Job => ({
  key: `greenhouse:${i}` as JobKey,
  company: `Co${i}`,
  title: verdict === "reject" && i % 2 ? "Accountant" : "ML Engineer",
  location: "New York, NY",
  url: `https://job-boards.greenhouse.io/co/jobs/${i}`,
  official: true,
  publishedAt: "",
  description: "desc",
  sources: [{ channel: "official_greenhouse", source: "board", url: "u", official: true, date: "", dateKind: "published", firstSeen: T0, lastSeen: T0 }],
  firstSeen: T0,
  lastSeen: T0,
  triage: { verdict, rule: verdict === "match" ? "match" : "role.out_of_scope", reason: "" },
  hints: {},
  size: "unknown",
  ...over,
});

describe("audit", () => {
  const jobs = [...Array.from({ length: 50 }, (_, i) => job(i, "match")), ...Array.from({ length: 80 }, (_, i) => job(100 + i, "reject")), ...Array.from({ length: 30 }, (_, i) => job(300 + i, "review"))];

  it("hides the verdicts from the auditor and is reproducible from its seed", () => {
    const a = drawSample(jobs, 7);
    expect(JSON.stringify(a.blind)).not.toMatch(/verdict|rule|match|reject|review/);
    expect(drawSample(jobs, 7).key).toEqual(a.key);
    expect(new Set(a.key.map((k) => k.key)).size).toBe(a.key.length);
    expect(a.key.filter((k) => k.stratum === "match")).toHaveLength(40);
  });

  it("scores false matches on matches and misses on uniform rejects only", () => {
    const key: AnswerKeyItem[] = [
      { id: "a1", key: "k1", stratum: "match", verdict: "match", rule: "match" },
      { id: "a2", key: "k2", stratum: "match", verdict: "match", rule: "match" },
      { id: "a3", key: "k3", stratum: "reject_any", verdict: "reject", rule: "level.senior" },
      { id: "a4", key: "k4", stratum: "reject_near", verdict: "reject", rule: "level.senior" },
      { id: "a5", key: "k5", stratum: "review", verdict: "review", rule: "level.unclear" },
    ];
    const s = scoreAudit(key, [
      { id: "a1", fit: "no", reason: "senior" },
      { id: "a2", fit: "yes", reason: "" },
      { id: "a3", fit: "no", reason: "" },
      { id: "a4", fit: "yes", reason: "" },
      { id: "a5", fit: "unsure", reason: "" },
    ]);
    expect(s).toMatchObject({ falseMatchRate: 0.5, missRate: 0, nearMissRate: 1, unsure: 1 });
    expect(s.disagreements.map((d) => d.id)).toEqual(["a1", "a4"]);
    expect(s.byRule["level.senior"]).toEqual({ judged: 2, disagree: 1 });
  });
});

describe("stage trust", () => {
  const score = (fm: number, miss: number, n = 20) => ({ falseMatchRate: fm, missRate: miss, matchJudged: n, rejectJudged: n }) as Parameters<typeof recordAudit>[1];

  it("demotes an auto stage on a failed audit and never promotes on its own", () => {
    const auto = { ...initialStage(T0), level: "auto" as const };
    expect(recordAudit(auto, score(0.2, 0), T0)).toMatchObject({ demoted: true, state: { level: "confirm" } });
    let s = initialStage(T0);
    let last;
    for (let i = 0; i < 3; i++) ({ state: s, ...last } = recordAudit(s, score(0.02, 0.03, 30), T0));
    expect(last!.promotable).toBe(true);
    expect(s.level).toBe("confirm");
  });

  it("does not judge on too small a sample", () => {
    const auto = { ...initialStage(T0), level: "auto" as const };
    expect(recordAudit(auto, score(0.5, 0.5, 5), T0).demoted).toBe(false);
  });
});

describe("outreach", () => {
  it("keeps only contacts printed in the cited post and drafts from the profile", () => {
    const u = makeUserData();
    const post = job(1, "review", {
      key: "url:https://news.ycombinator.com/item?id=9" as JobKey,
      company: "Tiny AI",
      title: "Tiny AI | ML Engineer | NYC",
      description: "We build ML tools. Email jobs@tiny.ai",
      official: false,
      hints: { unresolved: true, contact: "jobs@tiny.ai" },
      sources: [{ channel: "hn_hiring", source: "https://news.ycombinator.com/item?id=1", url: "https://news.ycombinator.com/item?id=9", official: false, date: T0, dateKind: "post_time", firstSeen: T0, lastSeen: T0 }],
    });
    const [e] = outreachQueue([post, job(2, "match", { size: "medium_large" })], u.profile, T0);
    expect(e).toMatchObject({ company: "Tiny AI", publicContacts: [{ value: "jobs@tiny.ai" }], confidence: "medium", status: "draft_not_sent" });
    expect(e!.draft).toContain(u.profile.identity.lastName);
    expect(e!.draft).toContain(u.profile.education[0]!.school);
  });
});

describe("catalog", () => {
  it("keeps hiring-post text through a save, since outreach reads it", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { readCatalog, writeCatalog } = await import("../src/store/catalog.ts");
    const path = join(mkdtempSync(join(tmpdir(), "cat-")), "catalog.jsonl");
    const post = job(1, "reject", { key: "url:https://news.ycombinator.com/item?id=9" as JobKey, description: "We use machine learning. jobs@x.ai", sources: [{ channel: "hn_hiring", source: "t", url: "u", official: false, date: "", dateKind: "post_time", firstSeen: T0, lastSeen: T0 }] });
    const other = job(2, "reject", { description: "Accounting role" });
    writeCatalog(path, [post, other]);
    const back = readCatalog(path);
    expect(back.get(post.key)!.description).toBe("We use machine learning. jobs@x.ai");
    expect(back.get(other.key)!.description).toBe("");
  });
});

describe("review list", () => {
  it("never re-asks what the candidate answered but can re-queue what the agent withdrew", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { ReviewList } = await import("../src/store/review.ts");
    const path = join(mkdtempSync(join(tmpdir(), "rv-")), "review.jsonl");
    const r = new ReviewList(path);
    const item = { id: "match:a", kind: "approve_match" as const, subject: "s", detail: "d" };
    expect(r.add(item)).toBe(true);
    r.resolve("match:a", "fit");
    expect(r.add(item)).toBe(false);
    r.add({ ...item, id: "match:b" });
    r.resolve("match:b", "withdrawn: over the cap");
    expect(new ReviewList(path).add({ ...item, id: "match:b" })).toBe(true);
  });
});
