# JobHunt Agent

A runnable Python MVP: one FastAPI process contains a durable polling worker, PostgreSQL stores jobs and an application ledger, and Playwright navigates forms with OpenAI selecting bounded actions. No broker, Redis, or microservices.

**Status:** Implemented and tested with mock ATS feeds, a deterministic browser double, and crash simulations. A separate real Chromium/local employer test is included. No real job application has been submitted by this project during development. This is a runnable MVP, not evidence of production reliability across arbitrary employer sites. The limit of 100/day is a configurable ceiling, not a throughput promise.

## Start on a VPS

Requires Docker Engine with Compose v2, outbound HTTPS, and approximately 4 GB RAM to start (monitor Chromium memory for your workload).

```bash
cp .env.example .env
cp config/profile.example.json config/profile.json
cp config/policies.example.json config/policies.json
# Put your actual resume at config/resume.pdf.
# Edit .env, profile.json and policies.json before enabling submission.
docker compose up -d --build
docker compose logs -f --tail=100 agent
```

Set `POSTGRES_PASSWORD` and `DASHBOARD_TOKEN` to separate random secrets. Use a URL-safe alphanumeric PostgreSQL password because it is interpolated into the database URL. Supply `OPENAI_API_KEY` and either `BRAVE_API_KEY` or `TAVILY_API_KEY`. Your OpenAI account must have access to the configured model and structured chat output. All packages used by the app are pinned in `uv.lock`.

The dashboard binds to VPS localhost. Access it with an SSH tunnel:

```bash
ssh -L 8000:127.0.0.1:8000 user@your-vps
```

Open http://127.0.0.1:8000. Use any username and your `DASHBOARD_TOKEN` as the HTTP Basic password. For public access, put a TLS reverse proxy and access control in front; do not expose raw HTTP Basic over the internet.

```bash
docker compose exec agent .venv/bin/python -m jobhunt check
docker compose exec agent .venv/bin/python -m jobhunt add-source https://company.example/careers
```

Changes to profile/answer bank and site policy files are read on each application. Restart the service after changing environment settings: `docker compose up -d --force-recreate agent`.

## Personal profile and truthful answers

`config/profile.json` is the persistent answer bank. Each answer has a question, exact label aliases, a string value, and `verified: true`. The examples are deliberately unverified placeholders. Enter your actual information and explicitly verify each answer. Exact labels/aliases are matched independently of the model after punctuation and case normalization. An LLM can select an existing answer key; it cannot invent or rewrite an answer.

Authorization and sponsorship answers must reflect your actual situation. Missing sponsorship information in a posting is allowed. Explicit restrictions are rejected by the deterministic filter. Location or early-career uncertainty goes to review. The filter is heuristic and the review queue is part of normal operation.

Add newly observed question labels to the appropriate verified answer's aliases only when their meanings are identical. Do not map a materially different question to an existing answer just to avoid review.

## Site permissions and submission

`config/policies.json` records exact hostnames whose automation and submission policies you have checked. Sites default to review. For a permitted site, set `automation_allowed` and, if applicable, `submission_allowed` to true and keep a permission reference. `allowed_hosts` lists exact additional application navigation hosts (for example an employer's ATS). Browser requests to private/reserved network addresses are blocked; a network firewall should also isolate the VPS from internal services.

`AUTO_SUBMIT=false` is the initial preparation mode. Set `AUTO_SUBMIT=true` after filling your profile, resume, and per-site policies. The worker automatically submits supported, permitted, fully populated forms. You do not need to approve every normal submission. It stops for:

- Unknown/ambiguous questions, unknown required fields, unsupported custom controls, checkbox/radio answers, or login/account creation.
- CAPTCHA, access challenges, restricted automation, robots.txt exclusions, legal declarations, and consent/signature steps.
- Ambiguous final buttons, absent confirmation, or browser/connection failure around submission.

Review jobs in the dashboard. Open the employer page to finish manual steps or submit manually. After a manual submission, choose **Confirm submitted manually** and record a confirmation reference. To retry a pre-submission preparation problem, fix the bank/policy and choose **Queue after review**. The queue does not override site policy or legal stops. An uncertain submission is never automatically retried; reconcile it manually with the employer and mark submitted or reject it. The MVP intentionally offers no one-click reset of an uncertain side effect.

The browser is a bounded DOM agent, not an unrestricted computer-control agent. Embedded cross-origin form widgets, complex custom controls, upload dialogs outside native file inputs, tenant-specific Workday flows and many login-dependent flows may require manual review or an adapter. Generic buttons defaulting to form submit are handled conservatively. No CAPTCHA solving, stealth plugins or anti-bot evasion are included.

## Discovery coverage

There is no built-in company list. Six rotating searches per discovery cycle combine eight role families with general web, company career pages, Greenhouse, Lever, Ashby and Workday queries. Returned sites become persistent sources, and links on career pages discover further sources. New sources and existing sources are polled in age order with failure backoff (up to 60 sources per cycle).

Adapters read paginated Lever public postings, Greenhouse public boards, Ashby public boards, common public Workday CXS career endpoints, and schema.org JobPosting JSON-LD on arbitrary career pages. Workday endpoint variants may fall back to HTML and require a new adapter. Generic JS-only pages without JSON-LD are not exhaustively scraped; their links are followed when visible in HTML. Search API indexing, provider coverage, robots rules and site-specific restrictions limit reach: no implementation can guarantee discovery of the entire web.

Sponsorship is not inferred from a company's reputation. The job text must contain an explicit restriction to trigger that rejection. Relevant jobs with uncertain US location or seniority are retained for review. The model does not broaden the search criteria silently.

ATS URL canonicalization and a unique employer/title fingerprint deduplicate jobs; the same normalized employer/title is intentionally treated as one application even across different locations. Employer aliases and differently titled cross-postings cannot always be identified automatically. Seed existing applications before enabling automation if you applied outside this ledger; the system cannot know your past external applications.

## Durability and evidence

PostgreSQL enforces unique job URLs, fingerprints and one application record per job. One worker holds a PostgreSQL advisory lock and claims jobs transactionally. Run exactly one Uvicorn worker. A preparation crash is recoverable. Before the final click, an application intent and screenshot hash are committed. After that point a failure becomes uncertain and consumes daily capacity on the intent's local day. Only a newly observed explicit confirmation phrase records automatic success. Screenshots, URLs, timestamps, exact matched confirmation text and SHA-256 hashes are retained in the application evidence ledger. Confirmations are page evidence, not independent employer-side verification.

Native required field validation runs before the final click. Hidden application state and custom widgets may need manual review. A single browser profile is persisted in `/app/data/browser`; the worker is serial to avoid conflicting profile writes. Expired sessions go to review.

Daily limits use `TIMEZONE` (default America/New_York); verified submission timestamps and uncertain intent timestamps determine daily usage. Daily JSON reports for the completed prior local calendar day are written to `/app/data/reports` at the first tick after rollover. After multi-day downtime, missed historical reports are not backfilled. The dashboard shows current counts and capacity. Reports are local, and no email is sent.

## Operations

```bash
docker compose ps
docker compose logs --tail=200 agent
docker compose restart agent
docker compose exec -T db pg_dump -U jobhunt jobhunt > jobhunt-backup.sql
```

Persist both named volumes (`postgres_data` and `browser_data`) and your config directory. Never run `docker compose down -v` unless you intend to delete history and sessions. Back up PostgreSQL, configuration and browser/evidence data together; do not run a second worker against a restored stale copy while the original is active. Backups contain sensitive personal data. Restrict file permissions and encrypt backups. Screenshots can contain your answers; retain them according to your own privacy needs.

The app and database have health checks, restart policies, rotated Docker logs, and bounded browser/discovery execution times. Docker restart policies restart exited containers; health checks alone do not restart an unhealthy container. Monitor health externally. A worker failure terminates the app so Compose can restart it. Back up before upgrading: the initial schema is created automatically; future schema changes require explicit migrations (no automated destructive schema upgrades).

Outbound page content and verified answer values are sent to your configured OpenAI model. API keys are never included in model prompts. Job text is treated as untrusted data, and model output is restricted to action IDs and verified answer keys. This reduces prompt-injection exposure but is not a security proof. Only run against sites you trust and permit.

## Local development and verification

```bash
uv sync --frozen
mkdir -p data
uv run pytest -q
uv run ruff check jobhunt tests
uv run playwright install --with-deps chromium
# Set profile/config and environment, then:
uv run uvicorn jobhunt.main:app --host 127.0.0.1 --port 8000 --workers 1
```

SQLite is the local default; production Compose explicitly uses PostgreSQL. SQLite tests do not validate PostgreSQL locking behavior. The test suite uses temporary databases and never sends real applications.

Optional real Chromium end-to-end test against a local HTTP employer fixture, with the LLM mocked and fake personal data:

```bash
RUN_BROWSER_TESTS=1 uv run pytest -q tests/test_real_browser.py
```

The fixture hosts a resume-upload form and checks the confirmation ledger. Normal CI uses a deterministic browser double to check the same state machine, including failure during final click and missing confirmation. In the development sandbox, Docker/PostgreSQL were unavailable and Chromium's CDN download failed, so the Compose build, live browser integration and real ATS behavior still need verification on the deployment host.

## Protocol references

- [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html)
- [Lever public postings API](https://github.com/lever/postings-api)
- [Ashby public Job Postings API](https://developers.ashbyhq.com/docs/public-job-posting-api)
- [Brave Search authentication](https://api-dashboard.search.brave.com/documentation/guides/authentication)
- [Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search)
- [Playwright Python Docker guidance](https://playwright.dev/python/docs/docker)

See `VALIDATION.md` for the measured development results and unverified deployment checks.
