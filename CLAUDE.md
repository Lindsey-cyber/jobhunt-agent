# jobhunt-agent

Applies to jobs for one candidate, and submits only what it can prove is correct. Read ARCHITECTURE.md before changing src/.

## Rules

- Every fact sent to an employer comes from `data/profile.yaml`, `data/answers.yaml` or the resume. If it is not there, the field is blocked, not guessed.
- `data/` holds the candidate's real profile, answers and resume, committed on purpose (private repo). `data/config.yaml` (trust level, auto-submit list, daily cap) and `data/ledger.jsonl` belong to the candidate. Do not edit them.
- Anything the agent cannot resolve goes on the daily review list (`jh pending`); the candidate reads it at the end of each day. Never block a run waiting for an answer.
- `src/plan`, `src/gate`, `src/verify` and `src/discover` stay pure. Browser, network and disk work lives in `src/ats`, `src/sources`, `src/run`, `src/store` and `src/org`. `tests/structure.test.ts` enforces this.
- Discovery is read-only toward employers and mail: it never opens an application form or sends anything. A source without an approved API is skipped and named in the report, never scraped behind a login.
- `src/run/apply.ts` is the only code that submits. It writes `submitted` to the ledger before the click.
- Never retry an `unconfirmed` application.
- A change under src/ is done when `npm run check` passes and one CLI run per the `verify-apply` skill shows it working.
- When you correct the same mistake twice, encode it as a test, type or structure check, not another line here.

## Skills

- `apply-to-job` applies to one posting and resolves holds.
- `verify-apply` drives the pipeline and collects evidence; its `features/` is the ATS map.
- `daily-discovery` runs the coordinator, the Gmail copy and the blind triage audit, and reports.
- `add-ats-adapter` adds or fixes an ATS from a captured page.
