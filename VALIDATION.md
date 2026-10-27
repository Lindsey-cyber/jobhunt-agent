# Validation record · v0.2 · 2026-10-28

Measured locally:

- Normal test suite: **51 passed, 2 skipped**. Skips are the real Chromium fixture (opt-in) and PostgreSQL advisory-lock test (requires disposable PostgreSQL).
- Ruff checks and dependency lock check passed. The existing installed Python dependencies are retained; version metadata is now 0.2.0.
- Real Uvicorn/worker startup with SQLite passed: `/healthz`, authenticated `/`, and authenticated `/api/stats` returned HTTP 200. Worker heartbeat, setup-blocked state, discovery tick without configured search keys, and clean shutdown were verified.
- Browser doubles exercise verified text fill, resume upload, final submission journaling, confirmation evidence, absent confirmation, final-click crash, successful multi-step save/continue, and crash during a step click.
- Tests cover exact radio matching, custom dropdown selection planning, unknown required fields, conflicting prefilled values, repeated-section disambiguation, verified answer persistence, pause control, independent discovery during an application, UTC dates, HTTP retries, credential stripping on redirects, two search providers with one failing, additional ATS readers, iframe link discovery, supplied sitemaps, configuration generation and secret-scan redaction.
- The baseline tests for sponsorship filtering, deduplication, daily caps, CSRF/authentication, crash recovery and uncertain-submission lockout remain passing.

Not passed or not run here:

- The opt-in real Chromium test was explicitly attempted. Chromium downloaded from the fallback Microsoft mirror, but launched with SIGTRAP in this sandbox. The real browser test failed at launch; it is not a successful application test. Direct diagnostic launch also exited with SIGTRAP.
- Docker/Compose build/runtime and PostgreSQL-specific behavior could not be executed: Docker and PostgreSQL binaries are absent. The workflow defines those checks for a connected repository, but remote CI has not run.
- No live search-provider or OpenAI navigation call used user credentials. No real resume, verified personal profile, site permissions or VPS access was provided.
- No actual employer application was submitted, and no production deployment or 100/day throughput has been demonstrated.

GitHub status: private repository created and verified at https://github.com/Lindsey-cyber/jobhunt-agent. The MVP baseline has been committed remotely; the v0.2 source and CI workflow are being published through the connected GitHub API. Remote CI results are tracked separately from the local checks above. No deployment or real employer submission is implied by repository publication.
