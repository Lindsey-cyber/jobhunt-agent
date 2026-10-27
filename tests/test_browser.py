"""Exercise the real submission state machine with deterministic browser/LLM doubles."""

import json
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select

import jobhunt.browser as browser
from jobhunt.db import Application, Job, Session
from jobhunt.discovery import store_job
from jobhunt.settings import settings
from jobhunt.worker import claim, record_failure


class Locator:
    def __init__(self, page, selector):
        self.page, self.selector = page, selector

    async def count(self):
        return 0

    async def inner_text(self):
        return (
            "Your application has been submitted"
            if self.page.submitted and self.page.confirm
            else "Apply for a job"
        )

    async def fill(self, value):
        self.page.filled = value

    async def set_input_files(self, path):
        self.page.uploaded = path

    async def click(self):
        if self.page.fail_click:
            raise RuntimeError("Browser crashed during final click")
        # Assert committed intent exists BEFORE the click.
        with Session() as s:
            assert s.scalar(select(Application)).state == "submission_intent"
        self.page.submitted = True


class Page:
    def __init__(self, confirm=True, fail_click=False):
        self.url = "https://employer.example/apply"
        self.submitted = False
        self.confirm = confirm
        self.fail_click = fail_click
        self.filled, self.uploaded = "", ""

    def locator(self, selector):
        return Locator(self, selector)

    def set_default_timeout(self, value):
        pass

    async def goto(self, *args, **kwargs):
        pass

    async def evaluate(self, script):
        if script == browser.EXTRACT:
            return [
                {
                    "id": "1",
                    "tag": "input",
                    "type": "text",
                    "label": "First Name",
                    "value": self.filled,
                    "required": True,
                },
                {
                    "id": "2",
                    "tag": "input",
                    "type": "file",
                    "label": "Resume",
                    "value": self.uploaded,
                    "required": True,
                },
                {
                    "id": "3",
                    "tag": "button",
                    "type": "submit",
                    "label": "Submit application",
                    "required": False,
                },
            ]
        return bool(self.filled and self.uploaded)

    async def screenshot(self, path, **kwargs):
        Path(path).write_bytes(b"mock screenshot evidence")

    async def wait_for_timeout(self, value):
        pass


@pytest.mark.parametrize("outcome", ["confirmed", "uncertain", "click_crash"])
async def test_submission_transaction(tmp_path, monkeypatch, outcome):
    profile = tmp_path / "profile.json"
    profile.write_text(
        json.dumps({"answers": {"first_name": {"question": "First Name", "value": "Ada", "verified": True}}})
    )
    resume = tmp_path / "resume.pdf"
    resume.write_bytes(b"%PDF-1.4 mock")
    policies = tmp_path / "policies.json"
    policies.write_text(
        json.dumps({"sites": {"employer.example": {"automation_allowed": True, "submission_allowed": True}}})
    )
    for key, value in {
        "profile_path": profile,
        "resume_path": resume,
        "policies_path": policies,
        "openai_api_key": "fake",
        "auto_submit": True,
    }.items():
        monkeypatch.setattr(settings, key, value)
    page = Page(confirm=outcome == "confirmed", fail_click=outcome == "click_crash")

    class Context:
        async def route(self, *args):
            pass

        async def new_page(self):
            return page

        async def close(self):
            pass

    class Chromium:
        async def launch_persistent_context(self, *args, **kwargs):
            return Context()

    @asynccontextmanager
    async def fake_pw():
        yield SimpleNamespace(chromium=Chromium())

    async def allowed(self, url):
        return True

    async def fake_plan(client, elements, body, answers):
        if not page.filled:
            return {"action": "fill", "element_id": "1", "answer_key": "first_name"}
        if not page.uploaded:
            return {"action": "upload", "element_id": "2"}
        return {"action": "submit", "element_id": "3"}

    async def no_sleep(value):
        pass

    monkeypatch.setattr(browser, "async_playwright", fake_pw)
    monkeypatch.setattr(browser.Web, "allowed", allowed)
    monkeypatch.setattr(browser, "plan", fake_plan)
    monkeypatch.setattr(browser.asyncio, "sleep", no_sleep)
    store_job("Acme", "New Grad AI Engineer", page.url, "US", "new grad")
    job = claim()
    if outcome == "confirmed":
        await browser.apply(job)
    else:
        with pytest.raises((browser.Review, RuntimeError)) as exc:
            await browser.apply(job)
        record_failure(job.id, exc.value)
    with Session() as s:
        a = s.scalar(select(Application))
        j = s.get(Job, job.id)
        assert a.state == ("submitted" if outcome == "confirmed" else "uncertain")
        assert j.status == ("submitted" if outcome == "confirmed" else "review")
        if outcome == "confirmed":
            assert a.evidence["confirmation"]["sha256"]
            assert a.submitted_at is not None
    assert claim() is None
