# 最新多渠道实测 · 2026-10-28

功能提交 `edd5326cbf0e03595759c2968b5721b6cc7affe3`：[CI](https://github.com/Lindsey-cyber/jobhunt-agent/actions/runs/40602703656) 73 tests passed；[真实多渠道与 ARM64](https://github.com/Lindsey-cyber/jobhunt-agent/actions/runs/40602703675)。

[完整搜索质量报告](docs/SEARCH_REPORT_2026-10-28.md)：7980 条真实观察记录（公开 7960 + Gmail 20），7536 个独立岗位/线索，44 个规则匹配，39 个匹配页可访问；近7天 0，近30天 6。自动申请关闭；OCI 未部署。

本次源代码包含岗位ID归因、自有域名/托管GH映射、只读邮件、官方发布日期核验及人工 Outreach 草稿。原始记录与私人邮件均未提交源码。后续内容为历史验证记录。

# Validation record · Discovery Preview · 2026-10-27 UTC

## Current live discovery verification

Functional commit `6bd7b6add965bfa2b70969e4f01c02abe0163f21` passed [CI](https://github.com/Lindsey-cyber/jobhunt-agent/actions/runs/40594404135): **62 tests passed** with PostgreSQL 17 and a real Chromium fixture, Ruff and the source secret scan passed, and the isolated Docker Compose startup/health check passed. Local tests: **59 passed, 3 skipped** (PostgreSQL and opt-in real browser). A Starlette/httpx dependency deprecation warning remains.

[Live discovery and native ARM64 run](https://github.com/Lindsey-cyber/jobhunt-agent/actions/runs/40594404305), preview `9b93c546112745d48afaf92015780606`, completed **2026-10-27 22:23:30 UTC**:

| Measurement | Actual result |
| --- | ---: |
| Brave/Tavily requests / search results | 0 / 0 — neither key configured |
| Public ATS boards read / failed | 6 / 0 |
| Raw ATS job observations | 476 |
| Company + title deduplicated jobs | 446 |
| Duplicate observations retained | 30 |
| Location-aware unique jobs | 471 |
| Different-location rows merged by company + title | 25 |
| Criteria matched / listing links verified | 16 / 16 |
| Review / rejected | 21 / 409 |
| Listing links checked / invalid / blocked | 100 / 0 / 0 |
| Listing URLs not checked | 376 |
| Application flows / applications submitted | 0 / 0 |

Sources were Quora (9), NewsBreak (66), BotAuto (25), SentiLink (39), Applied Intuition (329), and ID.me University Recruiting (8). These are counts before filtering. The sample boards were found through external web research and read through actual public ATS APIs. This is **not** a real Brave/Tavily credential test. Run status is correctly `partial_missing_search_keys`. [All 16 matched positions with URLs and dates](docs/LIVE_DISCOVERY_RESULTS.md). The private workflow artifact contains original responses, all 476 rows, dedup reasons and source dates. It expires after 30 days; download it for longer retention.

Matched examples include Quora Machine Learning Engineer New Grad (published 2026-10-15), Quora New Grad ML Platform (published 2026-09-25), Applied Intuition Research Engineer New Grad 2027 (published 2026-08-14), NewsBreak Junior & New Grad ML Infra (updated 2026-07-31; publication unknown) and BotAuto Deep Learning & Vision New Grad (updated 2026-09-25; publication unknown). Some other matched openings were published in 2024–2025: open/listing-accessible does not mean recent. Matches are heuristic candidates, not proven personal eligibility or working application forms.

The same workflow built the Dockerfile natively on `aarch64` and launched Chromium `141.0.7390.37` inside the container. The separate script opened generated test HTML only. OCI itself was **not connected or deployed**; see [OCI_ARM64.md](docs/OCI_ARM64.md).

The initial local live run captured six DNS failures and zero jobs; it was not presented as successful. The successful batch ran in GitHub Actions with normal outbound networking. Provider contract/unit tests use mocks and are separate from the live ATS evidence.

The actual 476-row artifact was also imported into an isolated local preview-only database: dashboard, filtered preview, JSON summary, deduplicated CSV, all-observation CSV and raw ZIP routes all returned HTTP 200. The Job/Application ledgers remained empty and the worker was disabled.

## Previous v0.2 validation

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
