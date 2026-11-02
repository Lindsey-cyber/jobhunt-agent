import { describe, expect, it } from "vitest";
import type { Job, JobKey } from "../src/domain/job.ts";
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

describe("catalog rules", () => {
  it("drops text only for rules that never read the description", async () => {
    const { TITLE_RULES } = await import("../src/store/catalog.ts");
    const { triage } = await import("../src/discover/triage.ts");
    const me = { needsSponsorship: true, usCitizen: false, hasPhd: false };
    const bodyOnly = (description: string) => triage({ title: "ML Engineer, New Grad", location: "New York, NY", description, official: true, hints: {} }, me).rule;
    for (const d of ["Pursuing PhD in Computer Science.", "Must be a U.S. Citizen with an active Secret clearance.", "Requires 5+ years of experience.", "We are unable to sponsor visas."]) {
      expect(TITLE_RULES).not.toContain(bodyOnly(d));
    }
  });
});

describe("hold tally", () => {
  it("separates missing answers, site mechanics and deliberate holds, grouping by shape", async () => {
    const { tallyHolds } = await import("../src/verify/holds.ts");
    const t = tallyHolds([
      { key: "a", reasons: ['required "Degree": no answer in profile or answer bank', 'fill error: Country: no option fits "New York"'] },
      { key: "b", reasons: ['fill error: City: no option fits "Austin"', "Lever submits through hCaptcha: review the filled form and press Submit yourself"] },
    ]);
    expect(t.find((x) => x.cause === "mechanic")).toMatchObject({ count: 2 });
    expect(t.filter((x) => x.cause === "answer")).toHaveLength(1);
    expect(t.filter((x) => x.cause === "by_design")).toHaveLength(1);
  });
});

describe("answer log", () => {
  it("adds the agent's answers to the bank, last line per id winning, withdrawals removing", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { appendAnswer, readAnswerLog } = await import("../src/store/answerlog.ts");
    const dir = mkdtempSync(join(tmpdir(), "jh-log-"));
    writeFileSync(join(dir, "answers.jsonl"), "");
    appendAnswer(dir, { id: "d1", question: "Why us?", aliases: [], answer: "first", origin: "generated" });
    appendAnswer(dir, { id: "d1", question: "Why us?", aliases: [], answer: "hers", origin: "human" });
    appendAnswer(dir, { id: "d2", question: "Why now?", aliases: [], answer: "x", origin: "generated" });
    appendAnswer(dir, { id: "d2", withdrawn: true });
    expect(readAnswerLog(dir)).toEqual([{ id: "d1", question: "Why us?", aliases: [], answer: "hers", origin: "human" }]);
  });
});
