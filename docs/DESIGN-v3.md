# Design v3: one policy, one eligibility answer, one daily page

Written 2026-11-02 after a day of friction. Each item names the problem it removes.

## Root causes seen

1. The candidate's decisions were scattered (chat, handoff docs, regex comments, answers.yaml, search.yaml, labels, code in cli.ts). Stages disagreed: discovery matched what applying then dropped; the model reviewer never heard of the seniority rule.
2. A posting had no single identity or state. Catalog, labels and ledger used different keys; a job re-found under another link looked new; the "review" state had no owner, so hundreds of postings went nowhere.
3. Questions were answered by one regex per phrasing. Every new phrasing held an application; a regex that matched the wrong meaning answered wrong (NewsBreak work authorization).
4. What the candidate had to do was spread over seven documents.
5. Approval asked her to confirm each match although her rule is "apply to every match".
6. The agent worked event by event, which cost tokens and drifted.

## The design

1. **One policy file** — `data/policy.yaml` holds every decision about what to apply to (excluded companies, window, seniority, H-1B, ATS lanes, apply-last titles). Every stage reads it. *(Step 1, done 2026-11-02.)*
2. **One eligibility answer** — `src/discover/eligibility.ts` (pure, tested) says for any posting: ok or not, with each reason, and whose lane it is (agent or candidate). Applying only orders and submits what it calls ok. *(Step 1, done.)*
3. **One identity and one state per posting** — the ATS job id is the key everywhere; states are new → eligible → applied / held (what is missing) / skipped (why). Every state has an owner and an exit. *(Step 2.)*
4. **One daily page** — `jh day` runs discover → model review → eligibility → apply newest first → reconcile → page. The page shows today's new postings newest first with their state, what was applied, the candidate's to-dos ranked by how many applications each unblocks, and decisions needed. It replaces the scattered docs. Anomalies (hold rate jump, many unseen questions, a failing source) stop the run and land on the page. *(Step 2.)*
5. **Apply by default, candidate vetoes** — eligible matches go to the queue; she strikes what she does not want on the page. *(Step 3.)*
6. **Answer from facts** — every fact about her (citizenship, visa, sponsorship, address, degrees, salary, start date, consents) gets an id; a model maps a new question to a fact and the answer is that fact's value with its id; only a question that maps to no fact holds. Sensitive families (authorization, sponsorship, EEO) keep phrase tests and a daily sample audit of submitted answers. *(Step 4.)*
