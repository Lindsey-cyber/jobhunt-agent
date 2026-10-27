# Research and design decisions · 2026-10-28

These are design references, not dependencies or claims that JobHunt matches their compatibility. No proprietary Simplify code was accessed or copied, and no third-party source code was copied into this project.

| Reference | Observed behavior | Change in this project |
| --- | --- | --- |
| [Simplify Copilot](https://simplify.jobs/copilot) | Reuses a profile to autofill forms and tracks submitted applications. | Match known question labels deterministically before asking an LLM; save explicitly verified answers in PostgreSQL for reuse. |
| [Simplify Autopilot](https://simplifyjobs.featurebase.app/en/help/articles/1784339-get-started-with-autopilot) | Submits supported applications using profile/resume settings; reports failures and allows manual completion. | Separate supported automation from manual review; retain submission evidence and never automatically replay uncertain outcomes. Our target is broader continuous discovery; we do not use Simplify's paid service. |
| [JobSpy](https://github.com/speedyapply/JobSpy), including `jobspy/__init__.py` | Separates provider readers, normalizes results, and collects multiple sources concurrently. | Keep small ATS readers, bounded parallel polling, shared filtering/deduplication, and independent Brave/Tavily failure handling. The package is not installed: direct public career APIs avoid adding pandas and platform-specific scraping dependencies. |
| [AutoApply](https://github.com/geckguy/AutoApply), including `extension-chrome/content/filler.js` | Distinguishes navigation from final submission and uses form events/visibility checks. | Handle custom dropdowns and exact radio answers; dispatch change/blur events; include hidden native resume uploads; journal multi-step navigation. Its extension is not bundled. |
| [browser-use](https://github.com/browser-use/browser-use) | Provides browser-agent abstractions around observed page controls. | Keep the existing bounded DOM action schema and re-observe controls after each action. The existing Playwright implementation is retained. No stealth or challenge bypass features are adopted. |
| [job-application-agent](https://github.com/torontodeveloper/job-application-agent) | Uses a dedicated persistent browser profile and pauses for review before submission. | Isolate persistent sessions by employer hostname and preserve a manual review path. We continue to auto-submit explicitly permitted, supported forms according to the original request. |

The code inspection informed the mechanisms above; it did not establish independent success-rate benchmarks for these projects. Marketing compatibility claims are not used as a compatibility test for JobHunt.

## Current boundaries

- Standard inputs/selects, verified radio groups, native resume uploads, supported ARIA comboboxes, and allowlisted embedded forms have implementation paths. A deployed browser test is still necessary before relying on a particular ATS tenant.
- Workday public CXS discovery and common save/continue forms are supported paths; login, legal declarations, custom repeated records without an unambiguous section, OTP and CAPTCHA remain manual.
- Both configured search APIs are queried, discovered ATS boards are persisted, and generic HTML/JSON-LD, embedded ATS links and supplied sitemap pages can reveal further sources. There is no fixed employer list, nor a guarantee of exhaustive web coverage.
- Research does not justify making up work authorization, experience, education or essay answers. Unknown facts still require a user-verified answer.
