---
name: verify-apply
description: Drive jobhunt-agent's apply pipeline against local fixture pages or a real posting and collect proof of what it filled, verified and submitted. Use after any change under src/, before raising trust for an ATS, or when an application's outcome is in doubt.
---

# Verify apply

The product surface is the `jh` CLI driving a real browser through an ATS form. A change is proven only when a run through that surface leaves evidence that matches what you claim.

## Launch

Fixture board, for anything that must not reach a real employer:

```bash
npx tsx src/dev/fixture-server.ts
```

Ready when it prints `fixtures at http://127.0.0.1:4173/...`. `PORT=<n>` picks another port. Each run gets a disposable data dir so it never touches the candidate's ledger:

```bash
export JH_DATA_DIR=$(mktemp -d) && cp examples/profile.example.yaml $JH_DATA_DIR/profile.yaml && printf '%%PDF-1.4\n' > $JH_DATA_DIR/resume.pdf
```

Add `config.yaml` with `trust: auto` and `autoSubmitAts: [greenhouse]` only when the run is meant to submit to the fixture.

## Doctor

```bash
npm run -s jh -- doctor
```

It must print the data dir you exported, a profile, an existing resume path, and a chromium version. If the data dir is `data/`, stop: you are about to drive the candidate's real ledger.

## Drive

```bash
npm run -s jh -- apply http://127.0.0.1:4173/acmerobotics/jobs/<fixture>
npm run -s jh -- pending
npm run -s jh -- status
```

`--approve` stands in for a human who reviewed the previous run's evidence. `--headed` shows the browser. The feature map in [features/README.md](features/README.md) lists what to drive per ATS.

Against a real posting, run without `--approve` and with the candidate's data dir only when the candidate asked for that application. Draft trust holds before submit, so a real-posting run is safe to repeat until it is approved.

## Evidence

Each run writes `$JH_DATA_DIR/runs/<key>/<timestamp>/`:

- `plan.json` lists every field, the chosen value, its source (profile path, answer-bank id or file) and its confidence.
- `readback.json` and `verify.json` hold what the page held after filling and the per-field comparison.
- `before-submit.png` and `before-submit.aria.yaml` show the page as it was submitted or held.
- `gate.json` holds the decision and every hold reason.
- `after-submit.png` and `confirmation.json` exist only when it submitted.

Proof standards:

- A submission is proven by the side effect, not the thank-you screen. On the fixture board, `curl -s http://127.0.0.1:4173/__submissions` must show exactly one body per submitted run, with the values from `plan.json`. On a real board, the confirmation email is the side effect (not yet automated; say so).
- A hold is proven by `gate.json` naming the reason you expected and `__submissions` not growing.
- Never report a field as filled from `plan.json` alone. `verify.json` is the readback.

## Cleanup

Stop the fixture server you started (`fuser -k 4173/tcp`, or the port you chose). Kill only what you started. Delete `$JH_DATA_DIR` only after you have copied the evidence you are citing somewhere that survives, or cite it inline.

## Helpers

`npm test` runs every unit test and the fixture end-to-end suite, including a page that silently drops a typed value. Run it after any change. It does not replace driving the CLI once.
