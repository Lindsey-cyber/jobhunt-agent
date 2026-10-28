import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { regressions, scoreEval } from "../src/discover/evalset.ts";
import { triage } from "../src/discover/triage.ts";
import { Profile } from "../src/profile/schema.ts";
import { candidateFacts } from "../src/run/discover.ts";
import { readBaseline, readLabels } from "../src/store/state.ts";

// The candidate's approve/reject decisions are the eval set. A change to the
// triage rules ships only if it scores no worse on them than the recorded
// baseline (`jh eval --record` after the candidate accepts a new score).
const DATA = join(import.meta.dirname, "..", "data");

describe("triage eval set", () => {
  const baseline = readBaseline(DATA);
  it.skipIf(!baseline || !existsSync(join(DATA, "profile.yaml")))("does not regress against the candidate's labels", () => {
    const me = candidateFacts(Profile.parse(parse(readFileSync(join(DATA, "profile.yaml"), "utf8"))));
    const score = scoreEval(readLabels(DATA), (e) => triage(e, me));
    expect(regressions(score, baseline!)).toEqual([]);
  });

  it("flags a drop in precision, recall or hidden fits", () => {
    const base = { n: 10, precision: 0.8, recall: 0.9, hiddenFits: 1, reviews: 2 };
    expect(regressions({ ...base }, base)).toEqual([]);
    expect(regressions({ ...base, recall: 0.8, hiddenFits: 2 }, base)).toHaveLength(2);
  });
});
