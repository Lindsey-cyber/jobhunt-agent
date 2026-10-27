"""Optional live Chromium integration. No external employer/API calls or real personal information."""

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from sqlalchemy import select

from jobhunt import browser
from jobhunt.db import Application, Session
from jobhunt.discovery import store_job
from jobhunt.settings import settings
from jobhunt.worker import claim

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_BROWSER_TESTS") != "1", reason="Set RUN_BROWSER_TESTS=1 after installing Chromium"
)


async def test_local_employer_submission(tmp_path, monkeypatch):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            if self.path == "/robots.txt":
                self.wfile.write(b"User-agent: *\nAllow: /\n")
            else:
                self.wfile.write(
                    b'<form method="post" enctype="multipart/form-data"><label>First Name<input name="first" required></label><label>Resume<input name="resume" type="file" required></label><button type="submit">Submit application</button></form>'
                )

        def do_POST(self):
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"Your application has been submitted")

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    profile = tmp_path / "profile.json"
    profile.write_text(
        json.dumps({"answers": {"first": {"question": "First Name", "value": "Test User", "verified": True}}})
    )
    resume = tmp_path / "resume.pdf"
    resume.write_bytes(b"%PDF-1.4 test resume")
    policies = tmp_path / "policies.json"
    policies.write_text(
        json.dumps({"sites": {"127.0.0.1": {"automation_allowed": True, "submission_allowed": True}}})
    )
    for key, value in {
        "profile_path": profile,
        "resume_path": resume,
        "policies_path": policies,
        "allow_local_test_urls": True,
        "openai_api_key": "fake",
        "auto_submit": True,
    }.items():
        monkeypatch.setattr(settings, key, value)

    async def deterministic_plan(client, elements, body, answers):
        for e in elements:
            if e["tag"] == "input" and not e["value"]:
                return {
                    "action": "upload" if e["type"] == "file" else "fill",
                    "element_id": e["id"],
                    "answer_key": "first",
                }
        e = next(e for e in elements if e["tag"] == "button")
        return {"action": "submit", "element_id": e["id"]}

    monkeypatch.setattr(browser, "plan", deterministic_plan)
    try:
        url = f"http://127.0.0.1:{server.server_port}/apply"
        store_job("Local Mock", "New Grad AI Engineer", url, "US", "new grad")
        await browser.apply(claim())
        with Session() as s:
            assert s.scalar(select(Application)).state == "submitted"
    finally:
        server.shutdown()
        server.server_close()
