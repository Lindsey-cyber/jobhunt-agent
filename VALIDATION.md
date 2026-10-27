# Validation record · v0.2 · 2026-10-28

## Verified GitHub Actions run

[Successful CI run](https://github.com/Lindsey-cyber/jobhunt-agent/actions/runs/40585145688) for functional code commit `6d960420f20dcebf912039439c4028b8e2d06d2f`:

- **54 tests passed**, with PostgreSQL 17 and an actual Chromium browser enabled; no tests skipped in that run. One dependency deprecation warning remains.
- The local HTTP employer fixture completed verified text filling, native resume PDF upload, browser submission, new confirmation detection and evidence persistence. It used fake personal data and a deterministic navigation planner; it did not call OpenAI or submit to an employer.
- PostgreSQL singleton locking and worker shutdown lock release passed. CI exposed a session-lock leak when returning a connection to the pool; the worker now explicitly unlocks before returning that connection, with a regression test using another backend.
- Ruff and the tracked-source secret scan passed: 37 tracked files, zero detected violations.
- Docker Compose image build, PostgreSQL health, worker/application startup, and HTTP health smoke test passed. The isolated test stack was cleaned up afterward; this is not a production deployment.

The initial CI run also exposed incorrect quoting of a PostgreSQL service health command; that configuration was fixed before the passing run. Earlier failed runs are retained for transparency.

## Local sandbox checks

- The standard SQLite suite passed **51 tests, with 3 skipped** (two PostgreSQL tests and the opt-in real-browser fixture).
- Worker heartbeat, setup-blocked state, discovery tick without configured providers, dashboard/statistics/health HTTP 200 responses and clean shutdown were verified locally.
- Chromium downloaded locally but exited with SIGTRAP in the restricted sandbox. That local launch did not pass; the separate GitHub runner successfully ran the real browser fixture as described above.

Coverage includes public ATS readers, two search providers with failure isolation, iframe links, supplied sitemaps, sponsorship/early-career filtering, deduplication, daily limits, verified answer matching, radio/custom dropdown planning, unknown required fields, prefilled conflicts, repeated sections, answer-bank persistence, pause control, independent discovery scheduling, retries, CSRF/authentication, step/final-click crashes and uncertain-submission lockout.

## Repository and remaining work

Private repository: https://github.com/Lindsey-cyber/jobhunt-agent. The original MVP baseline, v0.2 improvements and CI fixes have been committed remotely. The local checkout shares the published history and tracks origin/main.

No live search-provider/OpenAI navigation was tested with user credentials. No actual resume, verified personal profile, per-site permissions or production VPS access was provided. No real employer application was submitted. Live ATS tenant behavior, production deployment, unattended longevity and 100 completed applications/day remain unverified. The 100/day value is an enforced configurable ceiling, not measured throughput.
