---
name: apply-to-job
description: Apply to one job posting for the candidate with jobhunt-agent, resolve whatever the gate holds on, and report with evidence. Use when the candidate hands over a job URL or asks to work through held applications.
---

# Apply to a job

Restate the candidate's goal first: which job, and whether they want a draft for review or a submission.

## Steps

1. `npm run -s jh -- doctor`. The data dir must be the candidate's (`data/` unless `JH_DATA_DIR` says otherwise).
2. `npm run -s jh -- apply <url>`. Read the printed state and every `hold:` line. Open `gate.json` and `before-submit.png` in the printed run dir.
3. Resolve each hold reason by its class:
   - **Trust** ("trust level is draft", "not in autoSubmitAts"). Show the candidate the screenshot and the filled values from `readback.json`. Re-run with `--approve` only after they say yes to this application.
   - **No answer** for a non-sensitive question (motivation, how did you hear, availability). Draft an answer that uses only facts in `data/profile.yaml`, the resume and existing answers. Append it to `data/answers.yaml` with `origin: generated` and `company:` set when it names the company. Tell the candidate it is waiting for their approval; they approve by changing `origin` to `human`.
   - **Sensitive or vetoed** (authorization, sponsorship, citizenship, criminal history, EEO, compensation, references, attestations). Never draft. Ask the candidate for the answer. A sensitive answer they give goes into `answers.yaml` with the question copied exactly.
   - **Readback mismatch or fill error.** The adapter is wrong for this page. Do not retry hoping it passes. Save the page (scrub personal data) as a fixture and follow the `add-ats-adapter` skill to reproduce and fix it.
   - **Daily cap.** Stop for today.
4. Re-run `jh apply <url>` after each resolution. A held application restarts cleanly.
5. `unconfirmed` means the click happened and no confirmation appeared. Never re-run it. Check the candidate's inbox for a confirmation and tell them what you found.

## Never

- Edit `data/config.yaml`. Trust level, auto-submit ATS list and the daily cap are the candidate's decisions.
- Edit `data/ledger.jsonl` by hand.
- Answer a question with a fact that is not in the candidate's data.
- Solve a CAPTCHA. A page with one goes on the candidate's daily list (`submit_by_hand`) with the run dir; the candidate submits it.

## Submitting

The candidate approves postings on the daily list and allows the agent to submit them (2026-10-28): `jh apply <url> --approve` for an approved posting submits when every gate check passes, up to the daily cap.

- **Emailed security code** (Greenhouse asks for one after the first click; each click sends a new code). With the Gmail API authorized, `jh apply` reads it itself. In a session without it, run with `JH_CODE_FILE=.scratch/code.txt`, find the newest "Security code for your application to <company>" email with the Gmail connector after the click, and write the code to that file. Never ask the candidate to relay a code through chat: the browser that asked for it must be the one that enters it.
- **Unconfirmed**: never re-run. Look at `after-submit.png`; if a code or captcha is waiting, it is on the daily list for the candidate.
- **Accounts** (Workday and other boards that require one): the candidate allows creating them (2026-10-28) with the candidate's email and a generated password, stored only in `~/.config/jobhunt/accounts.json` (mode 600, never in the repo). If creation needs anything the agent cannot provide, the posting goes on the daily list.

## Reply

Job and company, final state, the run dir, each hold reason and how it was resolved, and anything waiting on the candidate.
