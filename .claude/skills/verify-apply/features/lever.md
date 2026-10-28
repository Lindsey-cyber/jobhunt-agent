# Lever

A candidate opens `https://jobs.lever.co/<company>/<id>/apply`, fills one native HTML form (`form#application-form`) and presses Submit, which runs hCaptcha first. The adapter is `src/ats/lever/adapter.ts`; it fills and verifies but never clicks submit.

## Sub-features

- `lv-text` text, email and textarea inputs, named `name`, `email`, `phone`, `location`, `org`, `urls[LinkedIn]`, and custom cards `cards[<uuid>][fieldN]`.
- `lv-choice` radio and checkbox groups (`cards[...]`, `pronouns`), matched by input value.
- `lv-select` native selects, including the EEO block `eeo[gender|race|veteran|disability]`.
- `lv-file` resume upload `input[name="resume"]`.
- `lv-captcha` the hCaptcha on submit: every run holds with "submit it yourself", even with `--approve`.

## How to get to it (user POV)

- A posting URL `https://jobs.lever.co/<company>/<id>`; append `/apply` for the form.

## Driving it with jh

Preconditions: fixture server running; disposable `JH_DATA_DIR` as in the README.

- **Real capture.** `npm run -s jh -- apply http://127.0.0.1:4173/lever/real-14fefcf2/apply`. Prints `held`; the first reason names hCaptcha; `verify.json` has no failed check; `__submissions` stays empty. `tests/lever.e2e.test.ts` asserts the same with `--approve` and auto trust.
- **Live posting.** Only for a posting the candidate approved, at draft trust: `jh apply https://jobs.lever.co/<company>/<id>/apply`.

## Gotchas

- Fixture `real-14fefcf2.html` is a REAL capture (AHEAD, 2026-10-28) with scripts removed; Lever's form is native HTML, so it fills without them. Not yet driven on a live Lever board: no approved posting is on Lever.
- The bare "Name" and "Date" fields under the EEO disability section are an attestation signature; the plan never fills them (only "Full name" maps to the profile).
- "I Acknowledge" checkboxes are attestations: blocked for the candidate.
- Because of hCaptcha the agent cannot complete a Lever application. After a draft run, the candidate opens the same URL, reviews the filled values from `readback.json`, and submits by hand.
