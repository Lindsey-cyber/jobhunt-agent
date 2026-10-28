# Greenhouse

A candidate opens a job on job-boards.greenhouse.io, fills one page (`form#application-form`), and presses `Submit application`. The adapter is `src/ats/greenhouse/adapter.ts`.

## Sub-features

- `gh-text` text and textarea inputs: name, email, phone, links, custom `question_<n>`.
- `gh-combobox` react-select single-value dropdowns (`.select__container`), including yes/no screening questions.
- `gh-file` resume upload `input#resume[type=file]`.
- `gh-eeo` optional demographic dropdowns answered from `profile.eeo` (default decline).
- `gh-submit` submit and confirmation text ("Thank you for applying", "application has been received").
- `gh-dedupe` a second run on a confirmed application does nothing.

## How to get to it (user POV)

- A job URL `https://job-boards.greenhouse.io/<board>/jobs/<id>`.
- A company careers page that embeds the board in `iframe#grnhse_iframe` (NOT supported yet: open the iframe's URL directly).

## Driving it with jh

Preconditions:

- Fixture server running; disposable `JH_DATA_DIR` as in the README.

- **Draft run.** `npm run -s jh -- apply http://127.0.0.1:4173/acmerobotics/jobs/basic`. Prints `held` with exactly two reasons (draft trust, not in autoSubmitAts). `verify.json` has `"ok": true`.
- **Approved submit.** Same URL with `--approve`. Prints `confirmed`. `__submissions` has one body with `question_102: "Yes"` and `resume: "resume.pdf"`.
- **Dedupe.** Same command again. Prints `already confirmed`; `__submissions` still has one body.
- **Human-only questions.** `.../jobs/needs-human`. Prints `held` naming the salary field and the free-text question.
- **Silent drop.** `.../jobs/drops-email` with auto trust. Prints `held`; `verify.json` shows the email check failing with an empty actual value.

## Gotchas

- All fixtures are SYNTHETIC (see `fixtures/greenhouse/README.md`). No selector here has been checked against a live board from this repo yet. Treat the first live run as a verification of the adapter, at draft trust.
- Unverified on live boards: the "Location (City)" geo search combobox, School as a server-searched combobox, multi-selects in `#demographic-section`, education blocks whose ids (`school--N`) change between renders, the phone country picker that displays only a flag after selection.
- Extract opens every combobox to read its options. A board with a server-searched combobox returns zero options; the plan types the answer and caps confidence at amber.
- The confirmation regex is a guess at Greenhouse's wording. An `unconfirmed` state after a real submit means check the inbox, never re-run.
