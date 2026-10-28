import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ApplicationKey } from "../src/domain/form.ts";
import { Ledger } from "../src/store/ledger.ts";

const fresh = () => new Ledger(join(mkdtempSync(join(tmpdir(), "jh-ledger-")), "ledger.jsonl"));
const key = "greenhouse:x/jobs/1" as ApplicationKey;

describe("Ledger", () => {
  it("lets a held application start again", () => {
    const l = fresh();
    l.transition(key, "planned", "r");
    l.transition(key, "held", "r");
    expect(l.canStart(key)).toBe(true);
  });

  it("restarts a run that died before submitting", () => {
    const l = fresh();
    l.transition(key, "planned", "r");
    expect(l.canStart(key)).toBe(true);
    l.transition(key, "planned", "r");
    l.transition(key, "verified", "r");
    expect(l.canStart(key)).toBe(true);
  });

  it("never restarts a submitted or unconfirmed application", () => {
    const l = fresh();
    for (const s of ["planned", "verified", "submitted"] as const) l.transition(key, s, "r");
    expect(l.canStart(key)).toBe(false);
    l.transition(key, "unconfirmed", "r");
    expect(l.canStart(key)).toBe(false);
    expect(() => l.transition(key, "planned", "r")).toThrow(/illegal/);
  });

  it("cannot submit without verifying", () => {
    const l = fresh();
    l.transition(key, "planned", "r");
    expect(() => l.transition(key, "submitted", "r")).toThrow(/illegal/);
  });

  it("survives a reload", () => {
    const path = join(mkdtempSync(join(tmpdir(), "jh-ledger-")), "ledger.jsonl");
    new Ledger(path).transition(key, "planned", "r");
    expect(new Ledger(path).state(key)).toBe("planned");
  });
});

describe("one application per job, whatever the URL", () => {
  it("opens Greenhouse's embed form and skips a job already applied to under another URL", async () => {
    const { formUrl } = await import("../src/run/apply.ts");
    expect(formUrl("https://job-boards.greenhouse.io/nuro/jobs/8122537")).toBe("https://job-boards.greenhouse.io/embed/job_app?for=nuro&token=8122537");
    expect(formUrl("https://jobs.lever.co/x/11111111-2222-3333-4444-555555555555/apply")).toBe("https://jobs.lever.co/x/11111111-2222-3333-4444-555555555555/apply");
  });

  it("finds an earlier application to the same job through a different URL", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { sameJob } = await import("../src/run/apply.ts");
    const ledger = new Ledger(join(mkdtempSync(join(tmpdir(), "lg-")), "ledger.jsonl"));
    const key = "greenhouse:job-boards.greenhouse.io/scaleai/jobs/4728014005" as ApplicationKey;
    for (const s of ["planned", "verified", "submitted", "confirmed"] as const) ledger.transition(key, s, "run");
    expect(sameJob(ledger, "https://scale.com/careers/apply?gh_jid=4728014005")).toEqual({ key, state: "confirmed" });
    expect(sameJob(ledger, "https://job-boards.greenhouse.io/embed/job_app?for=scaleai&token=4728014005")?.state).toBe("confirmed");
    expect(sameJob(ledger, "https://job-boards.greenhouse.io/scaleai/jobs/999")).toBeUndefined();
  });
});
