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
