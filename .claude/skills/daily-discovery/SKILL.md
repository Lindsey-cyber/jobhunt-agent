---
name: daily-discovery
description: Run jobhunt-agent's search pass (multi-channel job discovery and triage into the catalog) and hand the candidate the result. Use when the candidate asks for new jobs or the daily run.
---

# Daily discovery

`jh discover` does everything code can decide: fetch, parse, merge, triage, write the catalog. One step needs an agent: copying Gmail alerts (until the VPS has the Gmail API). Never send mail, never open an application form, never invent a job, a date or a contact. Per-company completeness (is each target company's official board fully read today) is not built yet; do not claim it.

## Steps

1. **Gmail alerts** (skip if the Gmail connector is absent, and say so in the reply). Spawn a worker that copies, read-only, every message matching
   `newer_than:30d (from:linkedin.com OR from:indeed.com OR from:glassdoor.com OR from:joinhandshake.com)` with `get_message` `PLAIN_TEXT` into `data/inbox/<date>/<messageId>.json` as `{id, threadId, date, sender, subject, viewUrl, body}`. The only allowed change to `body`: every URL is cut at its first `?`, then `?jobListingId=<digits>` or `?jk=<id>` is re-appended when the original had one. That strips tracking tokens and keeps job ids. `data/inbox/` is gitignored; it holds personal mail.
   A URL with no `?` and no job id in it (Handshake and newsletter click-tracking) is replaced by `<url-removed>`; copying those by hand stalled the first worker. The search returns at most 50 threads and no page token, so search in date slices (`after:`/`before:` a few days at a time) until a slice returns fewer than 50. On 2026-10-28 the 30-day window held 157 messages.
   Verify the copy in code, not by trust: re-fetch 3 random messages yourself and check that `parseAlert` gives the same job ids from your copy and from the fresh text (cut by the same rule).
2. `npm run -s jh -- discover --inbox data/inbox/<date>`. It updates the catalog and prints the counts. A source that fails lands on the review list; do not retry it by hand inside the run.
3. **Turn errors into structure.** Where a posting is plainly misjudged (read it), fix the rule in `src/discover/triage.ts` and add the case to `tests/discover.test.ts`. If the candidate has labels, `jh eval` must not regress before the change ships (`npm run check` runs it).
4. Commit `data/discovery/catalog.jsonl.gz` (the plain file is ignored).

## Reply

Counts per channel, matches with official pages, failed or skipped sources, what was fixed, and how many items wait in `jh pending`.
