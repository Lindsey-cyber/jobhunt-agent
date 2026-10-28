---
name: daily-discovery
description: Run jobhunt-agent's daily coordinator pass (multi-channel job discovery, triage, blind triage audit, approval queue, outreach queue, report and dashboard) and hand the candidate the result. Use when the candidate asks for new jobs, a search report, or the daily run.
---

# Daily discovery

The coordinator (`jh daily`) does everything code can decide. Two steps need an agent: copying Gmail alerts (until the VPS has the Gmail API) and the independent triage audit. Never send mail, never open an application form, never invent a job, a date or a contact.

## Steps

1. **Gmail alerts** (skip if the Gmail connector is absent, and say so in the reply). Spawn a worker that copies, read-only, every message matching
   `newer_than:30d (from:linkedin.com OR from:indeed.com OR from:glassdoor.com OR from:joinhandshake.com)` with `get_message` `PLAIN_TEXT` into `data/inbox/<date>/<messageId>.json` as `{id, threadId, date, sender, subject, viewUrl, body}`. The only allowed change to `body`: every URL is cut at its first `?`, then `?jobListingId=<digits>` or `?jk=<id>` is re-appended when the original had one. That strips tracking tokens and keeps job ids. `data/inbox/` is gitignored; it holds personal mail.
   A URL with no `?` and no job id in it (Handshake and newsletter click-tracking) is replaced by `<url-removed>`; copying those by hand stalled the first worker. The search returns at most 50 threads and no page token, so search in date slices (`after:`/`before:` a few days at a time) until a slice returns fewer than 50. On 2026-10-28 the 30-day window held 157 messages.
   Verify the copy in code, not by trust: re-fetch 3 random messages yourself and check that `parseAlert` gives the same job ids from your copy and from the fresh text (cut by the same rule).
2. `npm run -s jh -- daily --inbox data/inbox/<date>`. It writes `docs/reports/<date>/` and prints the counts. A source that fails lands on the review list; do not retry it by hand inside the run.
3. **Audit, independent.** Spawn an auditor on a different model from yours. Give it only `docs/reports/<date>/audit/brief.md` and `audit/blind.jsonl` (no report, no CSV, no rule names, no summary from you). It writes one line per item to `audit/verdicts.jsonl`: `{"id","fit":"yes"|"no"|"unsure","reason"}`. Then:
   `npm run -s jh -- audit score docs/reports/<date>/audit/verdicts.jsonl --auditor "<model>, blind, brief only"`
   This scores against the hidden answer key, demotes triage trust automatically if an error rate exceeds 10%, and puts every disagreement on the review list.
4. **Turn errors into structure.** For each disagreement where the auditor is plainly right (read the posting), fix the rule in `src/discover/triage.ts` and add the case to `tests/discover.test.ts`. If the candidate has labels, `jh eval` must not regress before the change ships (`npm run check` runs it). Re-run `jh report` after a rule change only together with a fresh `jh daily`; never edit report numbers by hand.
5. Publish `docs/reports/<date>/dashboard.html` as an artifact (update the same artifact each day) and commit the report dir and `data/discovery/catalog.jsonl.gz` (the plain file is ignored).

## Reply

Counts per channel, matches with official pages, 7/30-day fresh matches, false-match and miss rates with their sample sizes, failed or skipped sources, what was fixed after the audit, the dashboard link, and how many items wait in `jh pending`.
