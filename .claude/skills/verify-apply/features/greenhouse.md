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

- Verified on a live board (Scale AI 4728014005, draft run 2026-10-28, `data/runs/greenhouse_job_boards_greenhouse_io_scaleai_jobs_4728014005/2026-10-28T14-37-19-271Z`): text fields, phone with its country picker, the "Location (City)" geo search (answer bank `current-location`), resume upload, yes/no screening comboboxes, EEO dropdowns. Real capture: `fixtures/greenhouse/real-scaleai-4728014005.html` (scripts stripped; `tests/greenhouse-real.test.ts`).
- Live-board fixes, each from a failed draft run: the intl-tel-input search box is UI, not a field; file inputs take their label from the upload group; after an upload the input is replaced by the file name, which readback reads; dropdowns ignore clicks until hydration (wait for network idle); the phone country shows only "+1" when selected, so readback reads the option marked selected; options carry dial codes ("United States +1"), stripped before matching; `filter({ has })` matched nothing live, so containers use CSS `:has()`.
- Boards sometimes serve a blank page to quick repeat visits; `apply` reloads with backoff.
- Pages carry an invisible reCAPTCHA. Not yet seen at submit; if a challenge appears, the run must hold and ask the candidate, never solve it.
- A board configured with the employer's own careers page redirects there and embeds the form in an iframe (Nuro). Open `https://job-boards.greenhouse.io/embed/job_app?for=<board>&token=<id>` instead; not automated yet.
- Still unverified live: School as a server-searched combobox, multi-selects in `#demographic-section`, education blocks whose ids (`school--N`) change between renders, the confirmation text after a real submit.
- Extract opens every combobox to read its options. A board with a server-searched combobox returns zero options; the plan types the answer and caps confidence at amber.
- The confirmation regex is a guess at Greenhouse's wording. An `unconfirmed` state after a real submit means check the inbox, never re-run.
