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
- Solve a CAPTCHA or create an account with a password you made up. Ask the candidate.

## Reply

Job and company, final state, the run dir, each hold reason and how it was resolved, and anything waiting on the candidate.
