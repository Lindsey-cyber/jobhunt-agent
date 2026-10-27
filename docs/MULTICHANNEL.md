# Multi-channel discovery (applications disabled)

The catalog extends the existing readers, database and dashboard. It does not replace the application engine. It works without Brave/Tavily or OpenAI credentials:

```bash
docker compose exec agent .venv/bin/python -m jobhunt catalog --max-sources 40 --link-checks 150
```

Or select **Run official ATS + GitHub + public hiring sources** on the dashboard. The registry is `config/discovery-sources.example.json`; override `DISCOVERY_REGISTRY` with a private copy if needed. It configures 17 official employer boards, three New Grad repositories, HN hiring posts, YC/VC/AI board entry points and explicit unavailable-channel records. The separate employer cohort includes aliases and classification references. Its medium/large label is a curated priority category, not an audited current employee count. Unknown employers are not classified as small.

Known employers have priority. Relevant GitHub posting URLs discover further ATS boards, and successful specifications persist for future polling. HN examines the first 40 top-level comments of the latest Who is hiring thread. Generic career/YC/VC pages support machine-readable JobPosting data and ATS links; JavaScript-only or restricted pages can yield no jobs. These readers do not establish exhaustive platform coverage. Peer/funding intelligence and bespoke restricted-platform integrations remain future work.

The catalog does not require or invoke Brave/Tavily. The existing `preview` command remains available for optional provider gap-filling tests. Missing credentials yield no fake results. Source failures and skips remain in the report.

## Identity and attribution

`Opportunity` is an inactive posting/task identity, separate from the application ledger. `SourceAttribution` preserves each channel and original source URL. Exact ATS IDs and canonical destinations merge evidence; company + title never establishes identity. For Greenhouse, the official index provides Board/Job ID even when absolute_url uses an employer-owned domain; that explicit mapping joins hosted and custom career URLs without guessing from titles. Distinct IDs/unknown URLs remain distinct. Workday tenant/requisition IDs and Greenhouse/Lever/Ashby variants normalize explicitly. Opaque platform-to-employer mappings remain unresolved rather than being guessed.

Every observation retains raw capture reference, channel date, official publication date when supplied, actual first observation and last source check. Public listing verification time is separate. First observation and historic sources survive future runs. Official records outrank third-party metadata, including when official requirements reject a repository candidate. A third-party-only title match stays in review until authoritative requirements are available. Explicit sponsorship restrictions are excluded only against verified contradictory facts; unknown authorization goes to review. Missing sponsorship is allowed.

Greenhouse reads its complete lightweight index, then up to 40 relevant job details per board; potential candidates without details stay in review. Workday queries are bounded early-career/ML searches, not complete tenant crawls. Source checkpoints record added/missing IDs and successful snapshots. Failed polls never erase the previous checkpoint. Absence in a bounded query does not prove expiry.

`--incremental` honors source backoff instead of forcing a poll. After reviewing search quality, optional `CATALOG_SCHEDULED=true` enables six-hour discovery-only polling (`CATALOG_INTERVAL=21600`). It is off in this manual test phase. Compose continues to pin submission off. Keep one Uvicorn worker; concurrent catalog runs are rejected within the process. Existing application records are preserved; reconcile any legacy company/title identities before a later submission rollout.

## Gmail and restricted platforms

Authorized alerts can supply LinkedIn, Indeed, Glassdoor and Handshake leads. The parser removes personal tracking parameters and never clicks unsubscribe, one-click actions or opaque tracking URLs. Handshake alerts with explicit sender-supplied job IDs can remain unresolved leads. Neither alert subjects nor delivery dates become official job facts.

The connected ChatGPT Gmail account supports operator imports; its connection is not exported to the VPS. Native VPS polling requires separately configured OAuth with **gmail.readonly** scope. Use `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, or a short-lived `GMAIL_ACCESS_TOKEN`. Keep them in private `.env`. OAuth responses, raw email and tokens stay outside public raw captures. Only message list/get endpoints are used: no modification or sending.

To import a local Gmail API/connector message export:

```bash
docker compose exec agent .venv/bin/python -m jobhunt import-mail --import-file /app/data/private-mail.json
docker compose exec agent .venv/bin/python -m jobhunt catalog --import-file /app/data/mail-job-leads.json --max-sources 40
```

No approved direct jobs API/session integration is configured for LinkedIn, Indeed, Glassdoor, Handshake or Wellfound; those direct sources are skipped. Public hiring-post leads appear at `/outreach` and `/api/outreach`. Only contact addresses explicitly present in cited public posts are retained. Names are not inferred and addresses are not guessed. Drafts require the user's verified project/background before use. No sending route exists. Comprehensive recruiter/Hiring Manager research remains incomplete.

## Reports

The preview dashboard shows channel raw/unique/exclusive/shared counts, within-channel duplicate rates, validity among checked links, official 7/30-day publication counts and unknown dates. A posting can contribute to multiple channels, so channel counts need not sum to the global unique count. Application/reply/interview source value remains unmeasured until outcome evidence exists.

Use the 7/30-day filter and **Download this filter** for matching CSV. Full CSV retains experience snippets, company classification basis, canonical posting identity and source attributions as JSON. Per-run outputs include `summary.json`, `channels.json`, `jobs_all.json`, `jobs_deduplicated.json`, `matched.csv`, `outreach.json`, `observations.jsonl`, original public responses and standalone `report.html`. Progress snapshots survive interrupted source polling. HTTP success establishes public listing access only; no application form is exercised. The invalid-link denominator is the checked subset, never all discovered URLs.

During bounded public-page checks, an explicitly matching JobPosting JSON-LD record on an official ATS can add an official_page attribution and recover datePosted and job requirements. This can confirm a third-party candidate without any form interaction. Published dates stay distinct from Greenhouse updates, Lever creation, Workday start dates, repository-reported ages and email delivery. A source reporting "6d" does not establish an official posting date. Listings with unknown/old publication remain visible; known dates sort newest first and the dashboard can filter 7/30 days.
