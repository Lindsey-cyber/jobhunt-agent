# Architecture

The design follows one idea: an agent may act unattended only where its output is verifiable, and every correction gets pushed into the most structural layer that can hold it (code, then tests and CI, then rules, then skills, then human review).

## Pipeline

```
url ─▶ adapter.extract ─▶ FormSnapshot ─▶ buildPlan ─▶ FillPlan ─▶ adapter.fill
                                                                       │
          ledger ◀── submit ◀── gate ◀── compareReadback ◀── adapter.readback
```

| stage | code | pure | output |
|---|---|---|---|
| extract | `src/ats/<ats>/adapter.ts` | no | every field with label, kind, required, options |
| plan | `src/plan/plan.ts` | yes | per field: fill (value, source, confidence, sensitive), skip, or blocked |
| fill | adapter | no | |
| verify | adapter readback + `src/verify/compare.ts` | compare is | per-field expected vs actual, required fields still empty |
| gate | `src/gate/gate.ts` | yes | submit, or hold with every reason |
| submit | `src/run/apply.ts` | no | ledger `submitted` first, then the click, then `confirmed` or `unconfirmed` |

## Where answers come from

In order: a veto list (compensation, emergency contacts, references, attestations) blocks the field. An exact answer-bank match wins next, so the candidate can override anything. Then structured profile rules (identity, contact, links, education, work authorization, sponsorship, EEO). Then a fuzzy answer-bank match, never for a sensitive question. Options are matched strictly; a sensitive answer that matches no option blocks.

Confidence of 0.9 and above is green. Amber fills the field but holds an unattended submit.

## Trust ladder

| level | config | submits when |
|---|---|---|
| draft | `trust: draft` | never; a human reviews the evidence and re-runs with `--approve` |
| auto | `trust: auto`, ATS in `autoSubmitAts` | every field green, nothing blocked, readback matches, under the daily cap |

`--approve` lifts trust and confidence checks only. Nothing lifts a blocked field, a failed readback or the cap.

## Ledger

`data/ledger.jsonl` is append-only. States: planned, held, verified, submitted, confirmed, unconfirmed. Transitions are a table in `src/store/ledger.ts`; illegal ones throw. A run that dies before `submitted` restarts; nothing after `submitted` ever does.

## Evidence

Every run writes `data/runs/<key>/<timestamp>/` with the plan, readback, verify report, gate decision, screenshots and ARIA snapshot. The `verify-apply` skill defines what counts as proof.

## Borrowed

- Label normalization, the veto list, the sensitive-question rule and the Greenhouse markup notes come from formhand (MIT, github.com/fdjfnd222dd/formhand).
- The never-fabricate gate and the pre-apply checks (duplicate, knock-out questions, required sweep) follow career-ops (MIT, github.com/career-ops-hq/career-ops).
- The verification skill and feature map follow pstack's `create-verification-skill` (github.com/cursor/plugins/tree/main/pstack).

## Not built yet

Discovery (career-ops `providers/` for Greenhouse, Lever and Ashby public APIs), fit scoring, resume tailoring with a fact gate, Lever/Ashby/Workday adapters, inbox confirmation checks, an eval harness on captured pages, and a trust report per ATS.
