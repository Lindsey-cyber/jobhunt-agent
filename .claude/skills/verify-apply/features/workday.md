# Workday

A candidate opens `https://<tenant>.wdN.myworkdayjobs.com/<site>/job/<location>/<title>_<id>/apply/applyManually`, signs in to (or creates) an account for that employer, and walks a wizard: My Information, My Experience, Application Questions (1..n), Voluntary Disclosures, Self Identify, Review, then Submit. The adapter is `src/ats/workday/adapter.ts`; `apply()` drives it page by page (`prepare`, then fill / read back / `advance` per page; any page that does not verify stops the run as a hold).

## Sub-features

- `wd-account` one account per employer site. The password is derived from `JH_ACCOUNT_SECRET` and the host (`src/run/accounts.ts`), so the VPS and a session share accounts without storing passwords. A new account is activated by an emailed link (`waitForEmailLink`, unwrapping urldefense); an unactivated account uses the last 24 hours' link.
- `wd-field` questions are `[data-automation-id^="formField-"]`; the label or fieldset legend is the question, a trailing `*` marks it required. Ids are the suffix (`legalName--firstName`, `source`, questionnaire uuids).
- `wd-listbox` single-choice dropdowns: `button[aria-haspopup=listbox]`; the open menu is `ul[role=listbox]` that is not a `selectedItemList`. Escape does not close it; a second click does. A menu that will not open is filled by its option text and proved by readback.
- `wd-prompt` search boxes (`multiselectInputContainer`): type, pick a `promptOption`; Enter only when nothing is suggested (Enter takes the list's first item). Chosen items are `selectedItem` pills; a wrong one is removed with `DELETE_charm`.
- `wd-date` month/year spin boxes (`dateSectionMonth`/`dateSectionYear`), filled as "MM/YYYY".
- `wd-file` the resume block's `input[type=file]` (label "Resume/CV" from `resumeAttachments`).
- `wd-reveal` answers that reveal questions (the preferred-name block) get a second planning pass on the same page.

## How to get to it (user POV)

- A posting URL; `formUrl` appends `/apply/applyManually` (no resume-parsing autofill).
- The company is the tenant slug unless the catalog names it (`apply-approved` passes it).

## Driving it with jh

- `jh apply <posting> --approve` (needs `JH_ACCOUNT_SECRET` and the Gmail API for activation links). Each page leaves `page-N.html` / `page-N.png` in the run dir; a page that will not save leaves `page-N-not-saved.png`; a failed sign-in leaves `prepare-failed.*`.

## Gotchas

- Live so far (ADI, 2026-10-29): account creation and activation, My Information (all fields read back), My Experience (education entry, resume upload), Application Questions 1. Not yet seen: Application Questions 2, Voluntary Disclosures, Self Identify, Review, Submit and the confirmation text.
- Saving a page can take 10+ seconds; `advance` polls the progress bar for 30 seconds.
- Work-authorization questions can ask for indefinite authorization; a candidate who needs sponsorship answers No (tests/plan.test.ts).
