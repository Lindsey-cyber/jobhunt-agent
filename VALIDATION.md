# Validation record

Development validation on 2026-10-28:

- Python dependencies installed successfully with `uv sync`; `uv.lock` checked.
- `uv run pytest -q`: **32 passed, 1 skipped**. The skipped test is the opt-in real Chromium/local employer integration.
- `uv run ruff check jobhunt tests`: passed.
- Real Uvicorn startup with SQLite: HTTP 200 from `/healthz`, authenticated dashboard `/`, and authenticated `/api/stats`; clean shutdown verified.
- Worker-enabled Uvicorn startup with SQLite: database heartbeat, initial discovery tick with no configured providers/sources, health response, and clean shutdown verified.
- Mock adapter coverage: Greenhouse, Lever, Ashby, common Workday CXS, schema.org JobPosting, and discovery of a new ATS source through career-page links.
- Browser state-machine coverage: verified answer fill, resume upload, committed intent before final click, new confirmation evidence, missing confirmation, and simulated browser crash during final click.
- Other checks: sponsorship rules, US location ambiguity, source identity, cross-platform fingerprint deduplication, query-based job IDs, unsafe URL rejection, daily cap, preparation recovery, uncertain submission lockout, CSRF/authentication, and preservation of confirmed success after cleanup failure.

Not verified in this environment:

- Docker image build/Compose runtime and PostgreSQL-specific locking: Docker and PostgreSQL binaries were unavailable.
- A real Chromium application flow: Playwright installed, but Chromium download returned an invalid archive from the CDN in this environment. The real-browser fixture remains available as `RUN_BROWSER_TESTS=1 uv run pytest -q tests/test_real_browser.py` after installing Chromium on the target host.
- Live search provider requests, live OpenAI navigation, or employer submission: no credentials, personal profile, resume or site permissions were supplied.

**No real job applications were submitted.** The cap of 100 applications/day is implemented as a limit, and actual throughput/reliability remains to be measured on permitted sites with a completed verified profile. Arbitrary website compatibility and entire-web discovery are not guaranteed.
