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

## Discovery

```
config/watchlist.yaml ─▶ src/sources (fetch, read-only) ─▶ src/discover/parse ─▶ Sighting[]
Gmail alerts (data/inbox) ─┘                                                        │
       catalog ◀── link check ◀── triage ◀── mergeRun (JobKey only) ◀──────────────┘
          │
          └─▶ data/discovery/catalog.jsonl.gz
```

| stage | code | pure | output |
|---|---|---|---|
| fetch | `src/sources/fetch.ts` | no | official boards (Greenhouse, Lever, Ashby, bounded Workday search), New Grad GitHub lists, HN; boards found through list links are fetched too |
| parse | `src/discover/parse.ts` | yes | one `Sighting` per job per source, with what its date means (`published`, `list_age`, `email_received`...) |
| identity | `src/discover/identity.ts` | yes | `JobKey`: ATS job id (`greenhouse:<id>`, also from `gh_jid`), Lever/Ashby UUID, Workday tenant+requisition, platform ids for alerts, else the canonical URL. Company plus title never merges |
| merge | `src/discover/merge.ts` | yes | one `Job` per key with every source's first and last sighting; official fields win |
| triage | `src/discover/triage.ts` | yes | match, review or reject with a rule id; facts come from the profile |
| link check | `src/discover/links.ts` + `src/run/discover.ts` | classify is | valid, invalid, blocked or unverified per match |

Sponsorship: silence passes. An explicit no-sponsorship statement on the official posting rejects when the profile needs sponsorship; the same statement in a third-party copy only sends it to review.

`data/discovery/catalog.jsonl` carries history between runs (descriptions only where triage read past the title); git keeps its gzip copy `catalog.jsonl.gz`, which a fresh session reads when the plain file is missing. Raw run output stays in `data/runs/discovery/` (ignored). Alert emails live in `data/inbox/` (ignored: personal mail).

## Where answers come from

In order: a veto list (compensation, emergency contacts, references, attestations) blocks the field. An exact answer-bank match wins next, so the candidate can override anything. Then structured profile rules (identity, contact, links, education, work authorization, sponsorship, EEO). Then a fuzzy answer-bank match, never for a sensitive question. Options are matched strictly; a sensitive answer that matches no option blocks.

Confidence of 0.9 and above is green. Amber fills the field but holds an unattended submit.

## Trust ladder

| level | config | submits when |
|---|---|---|
| draft | `trust: draft` | never; a human reviews the evidence and re-runs with `--approve` |
| auto | `trust: auto`, ATS in `autoSubmitAts` | every field green, nothing blocked, readback matches, under the daily cap |

`--approve` lifts trust and confidence checks only. Nothing lifts a blocked field, a failed readback or the cap.

## Agent organization

The organization is real agent sessions, not scripts; its rules are in `docs/program/ORG.md`.

## Review list

`data/review.jsonl` (append-only, last line per id wins) holds everything waiting on the candidate: matches to approve, failed sources, questions. `jh pending` prints it with held applications. Items are never re-asked once resolved.

## Ledger

`data/ledger.jsonl` is append-only. States: planned, held, verified, submitted, confirmed, unconfirmed. Transitions are a table in `src/store/ledger.ts`; illegal ones throw. A run that dies before `submitted` restarts; nothing after `submitted` ever does.

## Evidence

Every run writes `data/runs/<key>/<timestamp>/` with the plan, readback, verify report, gate decision, screenshots and ARIA snapshot. The `verify-apply` skill defines what counts as proof.

## Borrowed

- Label normalization, the veto list, the sensitive-question rule and the Greenhouse markup notes come from formhand (MIT, github.com/fdjfnd222dd/formhand).
- The never-fabricate gate and the pre-apply checks (duplicate, knock-out questions, required sweep) follow career-ops (MIT, github.com/career-ops-hq/career-ops).
- The verification skill and feature map follow pstack's `create-verification-skill` (github.com/cursor/plugins/tree/main/pstack).

## Not built yet

A long-running VPS service (Gmail API read-only OAuth), an LLM triage worker for `review` items, fit scoring, resume tailoring with a fact gate, Lever/Ashby/Workday adapters, inbox confirmation checks, an eval harness on captured pages, and a trust report per ATS.
