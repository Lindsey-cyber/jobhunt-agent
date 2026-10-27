import csv
import io
import json
from datetime import timedelta

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from jobhunt import browser, worker
from jobhunt.db import Application, DiscoveryObservation, DiscoveryRun, Job, Session, Source, State, now
from jobhunt.main import app
from jobhunt.preview import csv_content, execute_preview, new_run, recover_previews, run_dir
from jobhunt.settings import Settings, settings


@pytest.fixture
def network(monkeypatch):
    async def safe(url):
        pass

    monkeypatch.setattr("jobhunt.net.safe_url", safe)
    monkeypatch.setattr(settings, "brave_api_key", "")
    monkeypatch.setattr(settings, "tavily_api_key", "")
    monkeypatch.setattr(settings, "http_retries", 0)


def job(i, location="New York, NY", title="New Grad ML Engineer"):
    return {
        "title": title,
        "jobUrl": f"https://jobs.ashbyhq.com/acme/{i}",
        "applyUrl": f"https://jobs.ashbyhq.com/acme/{i}/application",
        "location": location,
        "descriptionHtml": "Early career. Sponsorship information not specified.",
        "publishedAt": "2026-10-20T12:00:00Z",
    }


async def test_preview_retains_location_variants_and_never_queues(network, monkeypatch):
    async def forbidden(*args, **kwargs):
        pytest.fail("Preview must not invoke application/browser flow")

    monkeypatch.setattr(browser, "apply", forbidden)
    monkeypatch.setattr(settings, "auto_submit", True)  # Isolation must not depend on this flag.
    monkeypatch.setattr(settings, "discovery_only", False)
    with respx.mock:
        respx.get("https://api.ashbyhq.com/posting-api/job-board/acme").mock(
            return_value=httpx.Response(
                200,
                json={
                    "jobs": [job("1"), job("2", "San Francisco, CA"), job("3", title="Senior AI Engineer")]
                },
            )
        )
        for i in ["1", "2", "3"]:
            respx.get(f"https://jobs.ashbyhq.com/acme/{i}").mock(
                return_value=httpx.Response(
                    200, headers={"Content-Type": "text/html"}, text="<h1>Public job listing</h1>"
                )
            )
        run = new_run(["https://jobs.ashbyhq.com/acme"], max_sources=1)
        result = await execute_preview(run)
    assert result["status"] == "partial_missing_search_keys"
    assert result["stats"]["raw_ats_jobs"] == 3
    assert result["stats"]["deduplicated_jobs"] == 2
    assert result["stats"]["duplicates"] == 1
    assert result["stats"]["location_variants_merged"] == 1
    assert result["stats"]["verified_matched_jobs"] == 1
    assert result["stats"]["application_flows_opened"] == 0
    rows = json.loads((run_dir(run) / "jobs_all.json").read_text())
    assert len(rows) == 3 and any(r["duplicate_of"] for r in rows)
    assert rows[0]["application_url"].endswith("/application")
    assert rows[0]["posted_at"].startswith("2026-10-20")
    assert (run_dir(run) / rows[0]["raw_ref"]).is_file()
    assert "Discovery Preview" in (run_dir(run) / "report.html").read_text()
    with Session() as s:
        for model in [Job, Application, Source]:
            assert s.scalar(select(func.count()).select_from(model)) == 0
        assert s.get(State, "search_cursor") is None
        assert s.scalar(select(func.count()).select_from(DiscoveryObservation)) == 3


async def test_real_provider_contracts_preserve_original_search_results(network, monkeypatch):
    monkeypatch.setattr(settings, "brave_api_key", "test-only-provider-value")
    monkeypatch.setattr(settings, "tavily_api_key", "test-only-provider-value")
    with respx.mock:
        respx.get("https://api.search.brave.com/res/v1/web/search").mock(
            return_value=httpx.Response(
                200,
                json={
                    "web": {
                        "results": [
                            {
                                "url": "https://jobs.ashbyhq.com/acme/1",
                                "title": "Original title",
                                "description": "original snippet",
                            }
                        ]
                    }
                },
            )
        )
        respx.post("https://api.tavily.com/search").mock(
            return_value=httpx.Response(
                200,
                json={
                    "results": [
                        {
                            "url": "https://jobs.ashbyhq.com/acme/1",
                            "title": "Other provider title",
                            "content": "other snippet",
                        }
                    ]
                },
            )
        )
        respx.get("https://api.ashbyhq.com/posting-api/job-board/acme").mock(
            return_value=httpx.Response(200, json={"jobs": [job("1")]})
        )
        run = new_run(query_count=1, max_sources=1, max_link_checks=0, provenance="unit_test_mock")
        summary = await execute_preview(run)
    assert summary["stats"]["search_requests_succeeded"] == 2
    assert summary["stats"]["raw_search_results"] == 2
    assert summary["stats"]["unique_search_urls"] == 1
    raw = json.loads((run_dir(run) / "search_results.json").read_text())
    assert raw[0]["raw"]["title"] == "Original title"
    for path in (run_dir(run) / "raw").glob("*.json"):
        assert "test-only-provider-value" not in path.read_text()


async def test_invalid_blocked_and_unknown_dates_are_separate(network):
    a, b = job("1"), job("2", title="Junior Data Engineer")
    a.pop("publishedAt")
    with respx.mock:
        respx.get("https://api.ashbyhq.com/posting-api/job-board/acme").mock(
            return_value=httpx.Response(200, json={"jobs": [a, b]})
        )
        respx.get(a["jobUrl"]).mock(return_value=httpx.Response(404))
        respx.get(b["jobUrl"]).mock(return_value=httpx.Response(403))
        run = new_run(["https://jobs.ashbyhq.com/acme"], max_sources=1)
        result = await execute_preview(run)
    assert result["stats"]["invalid_links"] == 1
    assert result["stats"]["blocked_links"] == 1
    assert result["stats"]["verified_matched_jobs"] == 0
    rows = json.loads((run_dir(run) / "jobs_all.json").read_text())
    assert rows[0]["posted_at"] == ""


async def test_greenhouse_update_is_not_fabricated_publication_date(network):
    with respx.mock:
        respx.get("https://boards-api.greenhouse.io/v1/boards/acme/jobs").mock(
            return_value=httpx.Response(
                200,
                json={
                    "jobs": [
                        {
                            "title": "Junior AI Engineer",
                            "absolute_url": "https://job-boards.greenhouse.io/acme/jobs/1",
                            "location": {"name": "US"},
                            "content": "New grad",
                            "updated_at": "2026-10-28T00:00:00Z",
                        }
                    ]
                },
            )
        )
        run = new_run(["https://job-boards.greenhouse.io/acme"], max_sources=1, max_link_checks=0)
        await execute_preview(run)
    row = json.loads((run_dir(run) / "jobs_all.json").read_text())[0]
    assert not row["posted_at"]
    assert row["source_date_kind"] == "updated_at"
    assert row["source_date"].startswith("2026-10-28")


async def test_discovery_only_blocks_browser_and_worker(monkeypatch):
    assert Settings(_env_file=None).discovery_only is True
    monkeypatch.setattr(settings, "discovery_only", True)
    with pytest.raises(browser.Review, match="Discovery-only"):
        await browser.apply(None)
    monkeypatch.setattr(worker, "claim", lambda: pytest.fail("Discovery-only worker must not claim jobs"))
    monkeypatch.setattr(worker, "readiness", lambda: [])
    monkeypatch.setattr(settings, "poll_interval", 0.01)
    import asyncio

    stop = asyncio.Event()

    async def end():
        await asyncio.sleep(0.02)
        stop.set()

    await asyncio.gather(worker.application_loop(stop), end())


def test_csv_downloads_and_authentication():
    run = new_run(max_sources=1, max_link_checks=0)
    with Session.begin() as s:
        r = s.get(DiscoveryRun, run)
        r.status = "complete"
    (run_dir(run) / "jobs.csv").write_text(csv_content([{"title": "=malicious()", "company": "中文"}]))
    (run_dir(run) / "jobs_all.csv").write_text(csv_content([]))
    with TestClient(app) as c:
        assert c.get(f"/previews/{run}/jobs.csv").status_code == 401
        r = c.get(f"/previews/{run}/jobs.csv", auth=("agent", "test-secret"))
        assert r.status_code == 200
        rows = list(csv.DictReader(io.StringIO(r.content.decode("utf-8-sig"))))
        assert rows[0]["title"].startswith("'") and rows[0]["company"] == "中文"
        assert c.get(f"/previews/{run}", auth=("agent", "test-secret")).status_code == 200
        assert c.post("/previews", auth=("agent", "test-secret"), data={"csrf": "bad"}).status_code == 403


def test_stale_preview_is_interrupted_without_replay():
    run = new_run()
    with Session.begin() as s:
        r = s.get(DiscoveryRun, run)
        r.status = "running"
        r.started_at = now() - timedelta(hours=1)
    recover_previews()
    with Session() as s:
        assert s.get(DiscoveryRun, run).status == "interrupted"


def test_seed_urls_and_limits_are_checked():
    for url in ["file:///etc/passwd", "https://user:password@example.com"]:
        with pytest.raises(ValueError):
            new_run([url])
    with pytest.raises(ValueError):
        new_run(max_sources=0)
