import base64
import json
from datetime import timedelta

import httpx
import pytest
import respx
from sqlalchemy import func, select

from jobhunt.catalog import channel_metrics, group_rows, normalize, persist_attribution, run_catalog
from jobhunt.criteria import evaluate
from jobhunt.db import Application, Job, Opportunity, Session, SourceAttribution, SourceMonitor, now
from jobhunt.feeds import clean_alert_url, email_jobs, github_jobs
from jobhunt.identity import identity
from jobhunt.preview import run_dir


def row(url, channel="github_newgrad", **kwargs):
    raw = {"url": url, "company": "Acme", "title": "New Grad ML Engineer", "location": "US", **kwargs}
    return normalize(raw, {"url": "https://example.com/" + channel, "channel": channel}, 1, {})


def test_distinct_job_ids_not_company_title_merge():
    a = row("https://job-boards.greenhouse.io/acme/jobs/123")
    b = row("https://job-boards.greenhouse.io/acme/jobs/124", location="CA")
    c = row(
        "https://boards.greenhouse.io/acme/jobs/123?utm_source=repo",
        "official_ats",
        official=True,
        description="new grad",
    )
    b["ordinal"], c["ordinal"] = 2, 3
    result = group_rows([a, b, c])
    assert len(result) == 2 and len(result[0]["attributions"]) == 2
    assert result[0]["official"] and a["duplicate_of"] == 3
    assert identity("https://nvidia.wd5.myworkdayjobs.com/en-US/Board/job/USA/Test_JR123") == identity(
        "https://nvidia.wd5.myworkdayjobs.com/Board/job/USA/Other_JR123"
    )


def test_source_history_survives_subsequent_runs():
    first = row("https://example.com/jobs/1")
    first["observed_at"] = (now() - timedelta(days=2)).isoformat() + "Z"
    persist_attribution(group_rows([first]))
    second = row(
        "https://example.com/jobs/1",
        "official_ats",
        official=True,
        reported_date="2026-10-20T12:00:00Z",
        source_date_kind="published_at",
    )
    persist_attribution(group_rows([second]))
    assert second["first_seen"] == first["observed_at"]
    assert len(second["attributions"]) == 2
    assert second["earliest_source"] == "github_newgrad"
    with Session() as s:
        assert s.scalar(select(func.count()).select_from(Opportunity)) == 1
        assert s.scalar(select(func.count()).select_from(SourceAttribution)) == 2
        assert s.scalar(select(func.count()).select_from(Application)) == 0


def test_channel_contribution_and_dates_are_not_invented():
    a = row("https://example.com/a", reported_date="2d", source_date_kind="repository_reported_age")
    b = row("https://example.com/a", "official_ats", official=True)
    c = row("https://example.com/b", "official_ats", official=True)
    rows = [a, b, c]
    metrics = channel_metrics(rows, group_rows(rows))
    assert a["posted_at"] == ""
    assert metrics["official_ats"]["exclusive_postings"] == 1
    assert metrics["github_newgrad"]["cross_channel_shared"] == 1


def test_markdown_parser_inherits_company_and_excludes_closed():
    content = """# New Grad Positions
| Company | Role | Location | Apply | Age |
|---|---|---|---|---|
| Acme | New Grad ML Engineer | US | <a href="https://example.com/jobs/1">Apply</a> | 1d |
| ↳ | New Grad AI Engineer | NY | [Apply](https://example.com/jobs/2) 🔒 | 2d |
"""
    jobs = github_jobs(content, "https://github.com/acme/list")
    assert len(jobs) == 2 and jobs[1]["company"] == "Acme"
    assert jobs[1]["closed_hint"] and jobs[0]["early_career_source"]


def test_email_parser_strips_tracking_and_preserves_unknown():
    wrapped = "https://urldefense.com/v3/__https://www.linkedin.com/comm/jobs/view/123/?otpToken=private__;!!signature"
    assert clean_alert_url(wrapped) == "https://www.linkedin.com/jobs/view/123"
    html = '<a href="' + wrapped + '">Junior AI Engineer</a>'
    message = {
        "id": "sample",
        "payload": {
            "mimeType": "text/html",
            "headers": [{"name": "From", "value": "alerts@linkedin.com"}],
            "body": {"data": base64.urlsafe_b64encode(html.encode()).decode()},
        },
    }
    result = email_jobs(message)
    assert len(result) == 1 and result[0]["channel"] == "gmail_linkedin"
    assert result[0]["unresolved"] and "private" not in json.dumps(result)


def test_unknown_sponsorship_does_not_reject_and_interns_excluded():
    assert evaluate("New College Grad ML Engineer", "US", "")[0] == "queued"
    assert evaluate("Junior AI Engineer", "US", "Sponsorship is not provided.")[0] == "review"
    assert (
        evaluate("Junior AI Engineer", "US", "Sponsorship is not provided.", requires_sponsorship=True)[0]
        == "rejected"
    )
    assert evaluate("ML Engineer Intern", "US", "New grad")[0] == "rejected"


async def test_catalog_end_to_end_isolated_and_incremental(tmp_path, monkeypatch):
    async def safe(url):
        pass

    monkeypatch.setattr("jobhunt.net.safe_url", safe)
    registry = tmp_path / "sources.json"
    registry.write_text(
        json.dumps(
            {
                "version": 1,
                "sources": [
                    {
                        "url": "https://jobs.ashbyhq.com/acme",
                        "kind": "ashby",
                        "channel": "official_ashby",
                        "official": True,
                    }
                ],
            }
        )
    )
    with respx.mock:
        respx.get("https://api.ashbyhq.com/posting-api/job-board/acme").mock(
            return_value=httpx.Response(
                200,
                json={
                    "jobs": [
                        {
                            "title": "New Grad AI Engineer",
                            "jobUrl": "https://jobs.ashbyhq.com/acme/1",
                            "location": "US",
                            "publishedAt": "2026-10-20T12:00:00Z",
                        }
                    ]
                },
            )
        )
        respx.get("https://jobs.ashbyhq.com/acme/1").mock(
            return_value=httpx.Response(
                200, text="<h1>New Grad AI Engineer</h1>", headers={"content-type": "text/html"}
            )
        )
        result = await run_catalog(registry, max_sources=1, link_checks=1)
        assert result["stats"]["matched_jobs"] == 1
        assert result["stats"]["applications_submitted"] == 0
        assert (run_dir(result["id"]) / "matched.csv").is_file()
        second = await run_catalog(registry, max_sources=1, link_checks=0, force=False)
        assert second["stats"]["sources_skipped"] == 1
    with Session() as s:
        assert s.scalar(select(func.count()).select_from(Job)) == 0
        assert s.scalar(select(func.count()).select_from(SourceMonitor)) == 1


def test_import_url_cannot_inject_executable_link():
    with pytest.raises(ValueError):
        row("javascript:alert(1)")


def test_actual_audit_regressions_non_engineering_and_duration():
    assert (
        evaluate("Developer Advocate - AI & Developer Experiences", "US", "2 years of experience")[0]
        == "rejected"
    )
    assert evaluate("Post-Doctoral AI Researcher (2 year Fixed-Term)", "US", "")[0] == "review"
    assert evaluate("ML Engineer", "US", "This is a 2 year contract.")[0] == "review"
    assert row("https://example.com/jobs/1")["criteria_status"] == "review"
    assert (
        evaluate(
            "Junior AI Engineer",
            "US",
            "Must have unrestricted US work authorization.",
            requires_sponsorship=False,
        )[0]
        == "review"
    )


async def test_large_greenhouse_index_details_and_filtered_csv(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from jobhunt.main import app

    async def safe(url):
        pass

    monkeypatch.setattr("jobhunt.net.safe_url", safe)
    registry = tmp_path / "registry.json"
    registry.write_text(
        json.dumps(
            {
                "version": 1,
                "sources": [
                    {
                        "url": "https://job-boards.greenhouse.io/acme",
                        "kind": "greenhouse",
                        "channel": "official_greenhouse",
                        "official": True,
                    }
                ],
            }
        )
    )
    with respx.mock:
        respx.get("https://boards-api.greenhouse.io/v1/boards/acme/jobs", params={"content": "false"}).mock(
            return_value=httpx.Response(
                200,
                json={
                    "jobs": [
                        {
                            "id": 123,
                            "title": "New Grad AI Engineer",
                            "absolute_url": "https://job-boards.greenhouse.io/acme/jobs/123",
                            "location": {"name": "US"},
                        }
                    ]
                },
            )
        )
        respx.get("https://boards-api.greenhouse.io/v1/boards/acme/jobs/123").mock(
            return_value=httpx.Response(200, json={"content": "New grad. No visa sponsorship."})
        )
        result = await run_catalog(registry, max_sources=1, link_checks=0)
    assert result["stats"]["raw_observations"] == 1
    assert result["stats"]["review_jobs"] == 1  # unknown personal authorization
    with TestClient(app) as client:
        client.auth = ("user", "test-secret")
        url = "/previews/" + result["id"] + "/jobs.csv"
        assert len(client.get(url + "?status=matched").text.splitlines()) == 1
        assert "New Grad AI Engineer" in client.get(url + "?status=review").text
        assert len(client.get(url + "?days=7").text.splitlines()) == 1
        assert client.get("/outreach").status_code == 200


async def test_gmail_readonly_api_contract(monkeypatch):
    from jobhunt.feeds import read_gmail
    from jobhunt.settings import settings

    async def safe(url):
        pass

    monkeypatch.setattr("jobhunt.net.safe_url", safe)
    monkeypatch.setattr(settings, "gmail_access_token", "test-only-oauth-value")
    message = {
        "id": "sample",
        "payload": {
            "mimeType": "text/html",
            "headers": [{"name": "From", "value": "alerts@linkedin.com"}],
            "body": {
                "data": base64.urlsafe_b64encode(
                    b'<a href="https://www.linkedin.com/jobs/view/123">AI Engineer</a>'
                ).decode()
            },
        },
    }
    with respx.mock as router:
        router.get("https://gmail.googleapis.com/gmail/v1/users/me/messages").mock(
            return_value=httpx.Response(200, json={"messages": [{"id": "sample"}]})
        )
        router.get("https://gmail.googleapis.com/gmail/v1/users/me/messages/sample").mock(
            return_value=httpx.Response(200, json=message)
        )
        records = await read_gmail({})
        assert len(records) == 1
        assert all(call.request.method == "GET" for call in router.calls)
        assert all("test-only-oauth-value" not in json.dumps(r) for r in records)
