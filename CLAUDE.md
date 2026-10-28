# jobhunt-agent

Applies to jobs for one candidate, and submits only what it can prove is correct. Read ARCHITECTURE.md before changing src/.

## Rules

- Every fact sent to an employer comes from `data/profile.yaml`, `data/answers.yaml` or the resume. If it is not there, the field is blocked, not guessed.
- `data/config.yaml` (trust level, auto-submit list, daily cap) and `data/ledger.jsonl` belong to the candidate. Do not edit them.
- `src/plan`, `src/gate` and `src/verify` stay pure. Browser and disk work lives in `src/ats` and `src/run`. `tests/structure.test.ts` enforces this.
- `src/run/apply.ts` is the only code that submits. It writes `submitted` to the ledger before the click.
- Never retry an `unconfirmed` application.
- A change under src/ is done when `npm run check` passes and one CLI run per the `verify-apply` skill shows it working.
- When you correct the same mistake twice, encode it as a test, type or structure check, not another line here.

## Skills

- `apply-to-job` applies to one posting and resolves holds.
- `verify-apply` drives the pipeline and collects evidence; its `features/` is the ATS map.
- `add-ats-adapter` adds or fixes an ATS from a captured page.
