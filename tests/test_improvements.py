import asyncio
import hashlib
from datetime import datetime

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy import select

from jobhunt import forms, worker
from jobhunt.browser import profile_answers
from jobhunt.db import Job, Session, State, engine
from jobhunt.discovery import board, parse_date, source_for, store_job
from jobhunt.main import app
from jobhunt.net import Web, retry_delay
from jobhunt.settings import settings

BANK = {
    "sponsor": {"question": "Will you require visa sponsorship?", "value": "Yes", "verified": True},
    "name": {"question": "First Name", "value": "Ada", "verified": True},
}


def test_radio_matches_question_and_option():
    e = {
        "id": "1",
        "label": "Yes",
        "group_label": "Will you require visa sponsorship?",
        "option_label": "Yes",
        "type": "radio",
        "value": "false",
        "required": True,
    }
    assert forms.deterministic_action([e], BANK)["action"] == "check"
    assert forms.required_issues([e], BANK)
    e["value"] = "true"
    assert not forms.required_issues([e], BANK)
    e["group_label"] = "Are you authorized to work?"
    assert forms.deterministic_action([e], BANK) is None


def test_custom_dropdown_and_repeated_sections():
    e = {"id": "1", "tag": "button", "role": "combobox", "type": "", "label": "First Name", "value": ""}
    assert forms.deterministic_action([e], BANK)["action"] == "combobox"
    e["repeated"] = True
    assert forms.deterministic_action([e], BANK) is None
    bank = {"name": {**BANK["name"], "section": "Work Experience 1"}}
    e["section"] = "Work Experience 2"
    assert forms.deterministic_action([e], bank) is None
    e["section"] = "Work Experience 1"
    assert forms.deterministic_action([e], bank)


def test_required_unknown_and_prefilled_conflict():
    e = {"id": "1", "tag": "input", "type": "text", "label": "First Name", "value": "Grace", "required": True}
    with pytest.raises(forms.FormReview):
        forms.deterministic_action([e], BANK)
    assert forms.required_issues([e], BANK)
    e["label"] = "Unknown Legal Question"
    assert forms.required_issues([e], BANK)


def test_answer_ambiguity_is_never_guessed():
    bank = {**BANK, "duplicate": BANK["name"]}
    assert forms.answer_for({"label": "First Name"}, bank) is None


def test_hidden_upload_and_checkbox():
    elements = [
        {"id": "1", "type": "checkbox", "label": "First Name", "value": "false"},
        {"id": "2", "type": "file", "label": "Resume", "value": ""},
    ]
    assert forms.deterministic_action(elements, BANK)["action"] == "upload"


def test_email_punctuation_is_not_discarded():
    bank = {"email": {"question": "Email", "value": "a+b@example.com"}}
    with pytest.raises(forms.FormReview):
        forms.deterministic_action(
            [{"id": "1", "tag": "input", "type": "email", "label": "Email", "value": "ab@example.com"}], bank
        )


def test_utc_conversion_and_new_ats_recognition():
    assert parse_date("2026-10-28T09:00:00+08:00") == datetime(2026, 10, 28, 1)
    assert source_for("https://acme.wd5.myworkdayjobs.com/en-US/External/job/US/AI_R1")[1].endswith(
        "/External"
    )
    assert source_for("https://jobs.smartrecruiters.com/Acme/123")[0] == "smartrecruiters"
    assert source_for("https://acme.recruitee.com/o/ai")[0] == "recruitee"


async def test_search_continues_during_application(monkeypatch):
    store_job("Acme", "New Grad AI Engineer", "https://example.com/ai", "US", "new grad")
    stop, discovery_started = asyncio.Event(), asyncio.Event()
    applied = []

    async def slow_discovery():
        discovery_started.set()
        await stop.wait()

    async def apply(job, callback):
        assert discovery_started.is_set()
        applied.append(job.id)
        stop.set()

    monkeypatch.setattr(worker, "discover", slow_discovery)
    monkeypatch.setattr(worker, "apply", apply)
    monkeypatch.setattr(worker, "readiness", lambda: [])
    await asyncio.wait_for(worker.run(stop), timeout=2)
    assert applied
    with Session() as s:
        assert s.get(State, "worker").value["heartbeat"]


async def test_http_retry_and_redirect_does_not_leak_key(monkeypatch):
    async def noop(*args):
        pass

    monkeypatch.setattr("jobhunt.net.safe_url", noop)
    monkeypatch.setattr("jobhunt.net.asyncio.sleep", noop)
    with respx.mock:
        source = respx.get("https://api.example/search").mock(
            side_effect=[
                httpx.Response(429, headers={"Retry-After": "0"}),
                httpx.Response(302, headers={"Location": "https://cdn.example/result"}),
            ]
        )
        target = respx.get("https://cdn.example/result").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        web = Web()
        try:
            assert (
                await web.get("https://api.example/search", headers={"X-Subscription-Token": "private"})
            ).json()["ok"]
        finally:
            await web.close()
        assert source.call_count == 2
        assert "X-Subscription-Token" not in target.calls[0].request.headers
    assert retry_delay("999", 1) == 30


def test_verified_answer_saved_and_pause():
    csrf = hashlib.sha256((settings.dashboard_token + ":csrf").encode()).hexdigest()
    with TestClient(app) as c:
        auth = ("agent", "test-secret")
        payload = {"csrf": csrf, "key": "sponsor", "question": "Need sponsorship?", "value": "Yes"}
        assert c.post("/answers", auth=auth, data=payload).status_code == 400
        payload["verified"] = "yes"
        assert c.post("/answers", auth=auth, data=payload).status_code == 200
        assert profile_answers()["sponsor"]["value"] == "Yes"
        assert c.post("/control", auth=auth, data={"csrf": csrf, "paused": "true"}).status_code == 200
    with Session() as s:
        assert s.get(State, "control").value["paused"]


def test_step_crash_is_not_automatically_retried():
    store_job("Acme", "Junior ML Engineer", "https://acme.example/job", "US", "entry level")
    job = worker.claim()
    from jobhunt.db import Application, now

    with Session.begin() as s:
        a = s.scalar(select(Application))
        a.state, a.intent_at = "step_intent", now()
    worker.recover()
    with Session() as s:
        assert s.get(Job, job.id).status == "review"
        assert s.scalar(select(Application)).state == "uncertain"
    assert worker.claim() is None


@pytest.mark.skipif(engine.dialect.name != "postgresql", reason="Needs ephemeral PostgreSQL test database")
def test_postgres_singleton_lock():
    from sqlalchemy import text

    with engine.connect() as a, engine.connect() as b:
        assert a.scalar(text("SELECT pg_try_advisory_lock(742019384)"))
        assert not b.scalar(text("SELECT pg_try_advisory_lock(742019384)"))
        a.execute(text("SELECT pg_advisory_unlock(742019384)"))
        assert b.scalar(text("SELECT pg_try_advisory_lock(742019384)"))
        b.execute(text("SELECT pg_advisory_unlock(742019384)"))


def test_sponsorship_welcome_is_not_rejected():
    from jobhunt.criteria import evaluate

    assert (
        evaluate("Junior AI Engineer", "US", "Candidates with or without visa sponsorship are welcome.")[0]
        == "queued"
    )
    assert evaluate("Junior AI Engineer", "US", "We have no sponsorship restrictions.")[0] == "queued"
    assert evaluate("Junior AI Engineer", "US", "Sponsorship is not provided.")[0] == "rejected"
    assert evaluate("Junior AI Engineer", "US", "Applicants must be US citizens.")[0] == "review"
    assert evaluate("AI Engineer", "US", "Entry level. 3 years of experience preferred.")[0] == "queued"


async def test_new_public_ats_readers(monkeypatch):
    from jobhunt.db import Source

    async def noop(url):
        pass

    monkeypatch.setattr("jobhunt.net.safe_url", noop)
    with respx.mock:
        respx.get("https://api.smartrecruiters.com/v1/companies/Acme/postings").mock(
            return_value=httpx.Response(
                200, json={"totalFound": 1, "content": [{"id": "1", "name": "Junior ML Engineer"}]}
            )
        )
        respx.get("https://api.smartrecruiters.com/v1/companies/Acme/postings/1").mock(
            return_value=httpx.Response(
                200,
                json={
                    "ref": "https://api.smartrecruiters.com/v1/companies/Acme/postings/1",
                    "postingUrl": "https://jobs.smartrecruiters.com/Acme/1",
                    "location": {"country": "US"},
                    "jobAd": {"sections": {"jobDescription": {"text": "New grad"}}},
                },
            )
        )
        respx.get("https://other.recruitee.com/api/offers/").mock(
            return_value=httpx.Response(
                200,
                json={
                    "offers": [
                        {
                            "title": "Junior Data Engineer",
                            "slug": "data",
                            "country": "US",
                            "careers_url": "https://other.recruitee.com/o/data",
                        }
                    ]
                },
            )
        )
        respx.get("https://other.recruitee.com/api/offers/data").mock(
            return_value=httpx.Response(
                200, json={"offer": {"description": "Entry level", "requirements": ""}}
            )
        )
        web = Web()
        try:
            await board(web, Source(url="https://careers.smartrecruiters.com/Acme", kind="smartrecruiters"))
            await board(web, Source(url="https://other.recruitee.com", kind="recruitee"))
        finally:
            await web.close()
    with Session() as s:
        jobs = s.scalars(select(Job).where(Job.status == "queued")).all()
        assert len(jobs) == 2
        assert all("api.smartrecruiters.com" not in j.url for j in jobs)


async def test_both_search_providers_and_source_failure_isolation(monkeypatch):
    from jobhunt.db import Source
    from jobhunt.discovery import search

    async def noop(*args):
        pass

    monkeypatch.setattr("jobhunt.net.safe_url", noop)
    monkeypatch.setattr("jobhunt.net.asyncio.sleep", noop)
    monkeypatch.setattr(settings, "search_queries_per_cycle", 1)
    monkeypatch.setattr(settings, "brave_api_key", "test-brave")
    monkeypatch.setattr(settings, "tavily_api_key", "test-tavily")
    with respx.mock:
        respx.get("https://api.search.brave.com/res/v1/web/search").mock(return_value=httpx.Response(503))
        tavily = respx.post("https://api.tavily.com/search").mock(
            return_value=httpx.Response(
                200, json={"results": [{"url": "https://jobs.lever.co/newcompany/123"}]}
            )
        )
        web = Web()
        try:
            await search(web)
        finally:
            await web.close()
        assert tavily.calls[0].request.headers["Authorization"] == "Bearer test-tavily"
    with Session() as s:
        assert s.scalar(select(Source)).url == "https://jobs.lever.co/newcompany"


async def test_sitemap_and_embedded_ats(monkeypatch):
    from jobhunt.db import Source
    from jobhunt.discovery import career

    async def noop(url):
        pass

    monkeypatch.setattr("jobhunt.net.safe_url", noop)
    with respx.mock:
        respx.get("https://acme.example/robots.txt").mock(return_value=httpx.Response(404))
        respx.get("https://acme.example/sitemap.xml").mock(
            return_value=httpx.Response(
                200,
                headers={"Content-Type": "application/xml"},
                text="<urlset><url><loc>https://acme.example/careers/job/1</loc></url><url><loc>https://foreign.example/job/2</loc></url></urlset>",
            )
        )
        respx.get("https://acme.example/careers").mock(
            return_value=httpx.Response(
                200, text='<iframe src="https://boards.greenhouse.io/embed/job_board?for=acme"></iframe>'
            )
        )
        web = Web()
        try:
            await career(web, "https://acme.example/sitemap.xml")
            await career(web, "https://acme.example/careers")
        finally:
            await web.close()
    with Session() as s:
        sources = s.scalars(select(Source.url)).all()
        assert "https://boards.greenhouse.io/acme" in sources
        assert "https://acme.example/careers/job/1" in sources
        assert not any("foreign" in x for x in sources)


def test_configure_preserves_existing_secrets(tmp_path):
    from scripts.configure import configure

    (tmp_path / ".env.example").write_text(
        "POSTGRES_PASSWORD=replace-with-a-long-random-password\nDASHBOARD_TOKEN=replace-with-a-separate-long-random-password"
    )
    (tmp_path / "config").mkdir()
    for name in ["profile", "policies"]:
        (tmp_path / "config" / f"{name}.example.json").write_text("{}")
    configure(tmp_path)
    original = (tmp_path / ".env").read_text()
    assert "replace-with" not in original
    configure(tmp_path)
    assert (tmp_path / ".env").read_text() == original


def test_secret_scanner_never_prints_values(tmp_path, monkeypatch):
    from scripts.secret_scan import violations

    monkeypatch.chdir(tmp_path)
    path = tmp_path / "source.py"
    path.write_text("OPENAI_KEY = 'sk-proj-" + "x" * 40 + "'")
    bad = violations([path])
    assert bad and "x" * 40 not in str(bad)


@pytest.mark.skipif(engine.dialect.name != "postgresql", reason="Needs ephemeral PostgreSQL test database")
async def test_worker_shutdown_releases_session_lock():
    from sqlalchemy import text

    stop = asyncio.Event()
    stop.set()
    # Keep a different backend checked out so pool reuse cannot hide a leaked lock.
    with engine.connect() as probe:
        await worker.run(stop)
        try:
            assert probe.scalar(text("SELECT pg_try_advisory_lock(742019384)"))
        finally:
            probe.execute(text("SELECT pg_advisory_unlock(742019384)"))
