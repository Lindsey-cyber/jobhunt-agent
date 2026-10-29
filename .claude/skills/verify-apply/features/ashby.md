# Ashby

A candidate opens `https://jobs.ashbyhq.com/<org>/<id>/application`, fills one React form and presses "Submit Application", which runs invisible reCAPTCHA. The adapter is `src/ats/ashby/adapter.ts`; `formUrl` adds `/application` to a posting link.

## Sub-features

- `ab-entry` every question carries `data-field-path` (its id): text questions on `.ashby-application-form-field-entry`, radio and checkbox groups on a plain `div` around a `fieldset`. The title is `.ashby-application-form-question-title`; required shows as a `_required_` class on it.
- `ab-text` text, email, tel and textarea inputs (`_systemfield_name`, `_systemfield_email`, custom uuids).
- `ab-yesno` yes/no questions are two buttons `button[data-option=yes|no]`; the answer reads back from `aria-pressed="true"`.
- `ab-radio` labeled radio groups (`<entry>-labeled-radio-N`), options from `label[for]`; EEO gender, veteran, disability.
- `ab-checkbox` checkbox groups (EEO race), options from `label[for]`.
- `ab-search` location (`_systemfield_location`) and school (`_systemfield_education_history`) search boxes: type, wait for `[role=listbox] [role=option]`, take the suggestion `searchMatch` accepts; retries with the first part of the value.
- `ab-file` resume `input#_systemfield_resume`; a second file input at the top ("autofill from resume") is not a question and is ignored.
- `ab-sms` the phone entry carries SMS consent radios `communicationConsent` (given / notGiven); extracted as its own question.
- `ab-captcha` invisible reCAPTCHA (badge hidden). A visible challenge iframe becomes a blocker.

## How to get to it (user POV)

- A posting URL `https://jobs.ashbyhq.com/<org>/<id>`; the form is at `/application`.
- Company from the page title "<job> @ <Company>"; job title from `h1.ashby-job-posting-heading`; location from the left pane's "Location" section.

## Driving it with jh

- Fixture: `npm run fixtures`, then `jh apply http://127.0.0.1:4173/ashby/real-quora-40659fe7/application` (scripts stripped: native fields only).
- Live: `jh apply https://jobs.ashbyhq.com/<org>/<id> --approve`, or `jh apply-approved` for approved Ashby postings.

## Gotchas

- Verified live 2026-10-28 (Quora, run `data/runs/ashby_jobs_ashbyhq_com_quora_40659fe7_…/2026-10-28T23-28-50-528Z`, held on unanswered questions): text, SMS consent, the location search ("New York, United States" for "New York, New York, United States"), the school search, degree radios, yes/no buttons, resume upload readback, EEO radios. All 14 filled fields read back.
- Not yet verified live: the date picker, the confirmation text after submit, and how often reCAPTCHA challenges a headless browser.
- "Graduation Date" is a react-datepicker; no rule fills it yet, so it holds.
- "Are you legally authorized to work in that country?" refers to the previous question's country; it holds.

## System fields (2026-10-29)

- `_systemfield_name` is extracted as "Full Name" (a bare "Name" elsewhere can be a signature).
- `_systemfield_education_history` is one composite block: school search box, degree, field of study, start and end month/year dropdowns, "Still Student?". The plan value is `School | Degree | Field | MM/YYYY | MM/YYYY` (most recent degree); the adapter fills each part and reads the same shape back. Verified live on Applied Intuition (dry run).
