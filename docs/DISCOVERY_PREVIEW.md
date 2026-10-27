# Discovery Preview

This phase is read-only. Compose pins `AUTO_SUBMIT=false`, `DISCOVERY_ONLY=true`, and `SCHEDULED_DISCOVERY=false`. The preview uses HTTP discovery readers, never Playwright, the applicant profile, the application worker or form submission. OpenAI credentials and a resume are not needed for preview.

## Run once

Run `python3 scripts/configure.py`, then add `BRAVE_API_KEY` and/or `TAVILY_API_KEY` to the private `.env`. Start `docker compose up -d --build`, open the dashboard through an SSH tunnel and select **Run real discovery once**. The dashboard reports configured providers and errors explicitly. Its preview detail page filters matched/review/rejected jobs and downloads both deduplicated and all-observation CSV files, plus raw response evidence.

CLI equivalent inside Compose:

```bash
docker compose exec agent .venv/bin/python -m jobhunt preview --queries 9 --max-sources 12 --link-checks 100
```

To reproduce the first live ATS batch without search credentials:

```bash
docker compose exec agent .venv/bin/python -m jobhunt preview --seed-file config/preview-sources.example.json --queries 9 --max-sources 12 --link-checks 100
```

The six sample boards were found through external web research. They are explicit test inputs, not evidence of Brave/Tavily operation or a fixed production company list. With credentials, both providers can discover further ATS/company sources. Without credentials the run is `partial_missing_search_keys`; no synthetic results substitute for a failed or missing provider.

The private repository's **Live discovery preview** Actions workflow can also be run manually. Set Actions repository secrets `BRAVE_API_KEY` and/or `TAVILY_API_KEY` first. Its artifact contains the same exports and raw evidence for 30 days. The workflow makes no applications.

## Audit fields and counts

Each `data/previews/<run-id>/` contains `summary.json`, `search_results.json`, full raw HTTP response bodies, `observations.jsonl`, `jobs_all.json`, `jobs_deduplicated.json`, two CSVs and `report.html`. Request headers and bodies are not saved; configured provider key values are redacted. These local captures and configuration stay outside Git.

- Search results retain provider, query and original result payload. ATS rows retain listing URL, reported application URL (or clearly identified public listing fallback), description, source, observed time and filter reason.
- `posted_at` is populated only from an explicitly published timestamp. Greenhouse `updated_at`, Lever `created_at` and Workday start dates remain separate. Missing publication dates remain unknown; observation time is not publication time.
- Conservative application deduplication still uses company + title. Every discarded representative retains `duplicate_of`, reason and a different-location marker. Compare `unique_job_urls`, `location_aware_unique_jobs` and `location_variants_merged` to audit the effect. No raw variant is deleted.
- Matched means the deterministic criteria passed, not a verified personal eligibility assessment. Missing sponsorship is allowed. Uncertain location, experience or citizenship is placed in review. Older still-open jobs remain visible; known publication dates sort newest first within each status.
- Link checks are bounded HTTP GETs of public listing URLs, never application form navigation. HTTP 404/410 or known closed-job text counts as invalid. Access restrictions, network failures and unchecked URLs have separate statuses. A successful listing GET does not establish that its application form is functional.

See [VALIDATION.md](../VALIDATION.md) for actual live results and limitations.
