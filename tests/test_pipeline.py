import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy import select

from jobhunt.browser import Review, validate_answer
from jobhunt.criteria import evaluate
from jobhunt.db import Application, Job, Session, now
from jobhunt.discovery import board, source_for, store_job
from jobhunt.main import app
from jobhunt.worker import claim, count_today, record_failure, recover


@pytest.mark.parametrize(
    "description,status",
    [
        ("New grad opportunity. Sponsorship information not specified.", "queued"),
        ("New grad. We do not provide visa sponsorship.", "rejected"),
        ("Entry level. Visa sponsorship is not available.", "rejected"),
        ("Junior. Must have unrestricted US work authorization.", "rejected"),
        ("New grad. Must be authorized to work without sponsorship.", "rejected"),
        ("New grad. We offer visa sponsorship.", "queued"),
    ],
)
def test_sponsorship(description, status):
    assert evaluate("AI Engineer", "United States", description)[0] == status


@pytest.mark.parametrize(
    "title,location,description,status",
    [
        ("Senior ML Engineer", "US", "", "rejected"),
        ("Junior ML Engineer", "Canada", "", "review"),
        ("ML Engineer", "US", "5 years of professional experience required", "rejected"),
        ("Data Engineer", "US", "", "review"),
        ("New Grad Research Engineer", "New York, NY", "", "queued"),
        ("Marketing Associate", "US", "entry level", "rejected"),
    ],
)
def test_criteria(title, location, description, status):
    assert evaluate(title, location, description)[0] == status


def add_job(url="https://example.com/jobs/1"):
    store_job("Acme", "New Grad AI Engineer", url, "US", "New grad")
    with Session() as s:
        return s.scalar(select(Job))


def test_cross_platform_duplicate():
    assert store_job("Acme, Inc", "New Grad AI Engineer", "https://a.com/1?utm_source=x", "US")
    assert not store_job("Acme Inc", "New Grad AI Engineer", "https://b.com/1", "US")
    assert not store_job("Acme", "Other Title", "https://a.com/1?utm_source=y", "US")


def test_crash_after_intent_never_retries():
    add_job()
    job = claim()
    with Session.begin() as s:
        a = s.scalar(select(Application))
        a.state = "submission_intent"
        a.intent_at = now()
    recover()
    assert claim() is None
    with Session() as s:
        assert s.get(Job, job.id).status == "review"
        assert s.scalar(select(Application)).state == "uncertain"
        assert count_today(s) == 1


def test_preparation_crash_is_recoverable():
    add_job()
    claim()
    recover()
    assert claim() is not None


def test_review_vs_transient_retry():
    add_job()
    job = claim()
    record_failure(job.id, RuntimeError("temporary failure"))
    with Session() as s:
        assert s.get(Job, job.id).status == "queued"
        assert s.get(Job, job.id).next_attempt > now()
    record_failure(job.id, Review("Unknown work authorization question"))
    with Session() as s:
        assert s.get(Job, job.id).status == "review"


def test_answer_alias_prevents_invented_question_mapping():
    validate_answer({"label": "First Name *", "type": "text"}, {"question": "First Name", "value": "Ada"})
    with pytest.raises(Review):
        validate_answer(
            {"label": "Do you need sponsorship?", "type": "text"}, {"question": "First Name", "value": "Ada"}
        )


def test_dashboard_and_csrf():
    with TestClient(app) as client:
        assert client.get("/").status_code == 401
        assert client.get("/healthz").status_code == 200
        auth = ("agent", "test-secret")
        assert client.get("/", auth=auth).status_code == 200
        assert (
            client.post("/sources", auth=auth, data={"url": "https://example.com", "csrf": "bad"}).status_code
            == 403
        )


async def test_greenhouse_feed(monkeypatch):
    from jobhunt.db import Source
    from jobhunt.net import Web

    async def noop(url):
        return None

    monkeypatch.setattr("jobhunt.net.safe_url", noop)
    with respx.mock:
        respx.get("https://boards-api.greenhouse.io/v1/boards/acme/jobs").mock(
            return_value=httpx.Response(
                200,
                json={
                    "jobs": [
                        {
                            "title": "New Grad ML Engineer",
                            "absolute_url": "https://boards.greenhouse.io/acme/jobs/1",
                            "location": {"name": "US"},
                            "content": "Entry level",
                        }
                    ]
                },
            )
        )
        web = Web()
        try:
            await board(web, Source(url="https://boards.greenhouse.io/acme", kind="greenhouse"))
        finally:
            await web.close()
    with Session() as s:
        assert s.scalar(select(Job)).status == "queued"


def test_source_recognition():
    assert source_for("https://jobs.lever.co/acme/id")[1] == "https://jobs.lever.co/acme"
    assert source_for("https://jobs.ashbyhq.com/acme/id")[0] == "ashby"


def test_foreign_location_does_not_match_state_word():
    assert evaluate("Junior AI Engineer", "Remote in Canada", "")[0] == "review"
    assert evaluate("Junior AI Engineer", "Remote or London", "")[0] == "review"


@pytest.mark.parametrize(
    "kind,url,endpoint,payload",
    [
        (
            "lever",
            "https://jobs.lever.co/acme",
            "https://api.lever.co/v0/postings/acme",
            [
                {
                    "text": "Junior AI Engineer",
                    "hostedUrl": "https://jobs.lever.co/acme/1",
                    "categories": {"location": "US"},
                    "descriptionPlain": "Entry level",
                }
            ],
        ),
        (
            "ashby",
            "https://jobs.ashbyhq.com/acme",
            "https://api.ashbyhq.com/posting-api/job-board/acme",
            {
                "jobs": [
                    {
                        "title": "Junior AI Engineer",
                        "jobUrl": "https://jobs.ashbyhq.com/acme/1",
                        "location": "US",
                        "descriptionHtml": "Entry level",
                    }
                ]
            },
        ),
    ],
)
async def test_other_feeds(monkeypatch, kind, url, endpoint, payload):
    from jobhunt.db import Source
    from jobhunt.net import Web

    async def noop(url):
        pass

    monkeypatch.setattr("jobhunt.net.safe_url", noop)
    with respx.mock:
        respx.get(endpoint).mock(return_value=httpx.Response(200, json=payload))
        web = Web()
        try:
            await board(web, Source(url=url, kind=kind))
        finally:
            await web.close()
    with Session() as s:
        assert s.scalar(select(Job)).status == "queued"


async def test_dynamic_source_from_company_career_page(monkeypatch):
    from jobhunt.db import Source
    from jobhunt.discovery import career
    from jobhunt.net import Web

    async def noop(url):
        pass

    monkeypatch.setattr("jobhunt.net.safe_url", noop)
    html = """<script type="application/ld+json">{"@context":"https://schema.org", "@type":"JobPosting", "title":"Junior ML Engineer", "hiringOrganization":{"name":"Acme"}, "jobLocation":{"address":{"addressCountry":"US"}}, "description":"New grad"}</script><a href="https://jobs.ashbyhq.com/new-company">More jobs</a>"""
    with respx.mock:
        respx.get("https://acme.example/robots.txt").mock(return_value=httpx.Response(404))
        respx.get("https://acme.example/careers").mock(return_value=httpx.Response(200, text=html))
        web = Web()
        try:
            await career(web, "https://acme.example/careers")
        finally:
            await web.close()
    with Session() as s:
        assert s.scalar(select(Job)).status == "queued"
        assert s.scalar(select(Source)).url == "https://jobs.ashbyhq.com/new-company"


async def test_workday_feed(monkeypatch):
    from jobhunt.db import Source
    from jobhunt.net import Web

    async def noop(url):
        pass

    monkeypatch.setattr("jobhunt.net.safe_url", noop)
    with respx.mock:
        respx.get("https://acme.wd1.myworkdayjobs.com/robots.txt").mock(return_value=httpx.Response(404))
        respx.post("https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/External/jobs").mock(
            return_value=httpx.Response(
                200,
                json={
                    "total": 1,
                    "jobPostings": [
                        {
                            "title": "Junior ML Engineer",
                            "externalPath": "/job/US/Engineer_R1",
                            "locationsText": "US",
                        }
                    ],
                },
            )
        )
        respx.get("https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/External/job/US/Engineer_R1").mock(
            return_value=httpx.Response(
                200, json={"jobPostingInfo": {"location": "US", "jobDescription": "New grad"}}
            )
        )
        web = Web()
        try:
            await board(web, Source(url="https://acme.wd1.myworkdayjobs.com/External", kind="workday"))
        finally:
            await web.close()
    with Session() as s:
        assert s.scalar(select(Job)).status == "queued"


def test_limit_blocks_more_work(monkeypatch):
    from jobhunt.settings import settings

    monkeypatch.setattr(settings, "daily_limit", 1)
    add_job()
    claim()
    with Session.begin() as s:
        a = s.scalar(select(Application))
        a.state, a.intent_at = "submission_intent", now()
    store_job("OtherCo", "Junior AI Engineer", "https://other.example/1", "US", "new grad")
    assert claim() is None


def test_url_identity_and_unsafe_link():
    from jobhunt.db import canonical_url

    assert canonical_url("https://a.example/careers?job=123&utm_source=x") != canonical_url(
        "https://a.example/careers?job=124&utm_source=x"
    )
    assert not store_job("Bad", "Junior AI Engineer", "javascript:alert(1)", "US")


def test_completed_submission_survives_cleanup_error():
    add_job()
    job = claim()
    with Session.begin() as s:
        a = s.scalar(select(Application))
        a.state, a.submitted_at = "submitted", now()
    record_failure(job.id, RuntimeError("browser close failed"))
    with Session() as s:
        assert s.get(Job, job.id).status == "submitted"


def test_review_cannot_reset_uncertain_submission():
    import hashlib

    from jobhunt.settings import settings

    add_job()
    job = claim()
    with Session.begin() as s:
        a = s.scalar(select(Application))
        a.state, a.intent_at = "submission_intent", now()
    recover()
    csrf = hashlib.sha256((settings.dashboard_token + ":csrf").encode()).hexdigest()
    with TestClient(app) as client:
        r = client.post(
            f"/jobs/{job.id}/review",
            auth=("agent", "test-secret"),
            data={"action": "queue", "note": "retry", "csrf": csrf},
        )
        assert r.status_code == 409
