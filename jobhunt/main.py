import asyncio
import hmac
import logging
import os
import signal
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Form, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.templating import Jinja2Templates
from sqlalchemy import func, select, text

from jobhunt.db import Application, Event, Job, Session, Source, event, init_db, now
from jobhunt.discovery import remember_source
from jobhunt.net import safe_url
from jobhunt.settings import settings
from jobhunt.worker import count_today, run

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
security = HTTPBasic()


def auth(credentials: HTTPBasicCredentials = Depends(security)):
    if not settings.dashboard_token:
        raise HTTPException(503, "Set DASHBOARD_TOKEN before using the dashboard")
    if not hmac.compare_digest(credentials.password.encode(), settings.dashboard_token.encode()):
        raise HTTPException(401, "Invalid credentials", headers={"WWW-Authenticate": "Basic"})


@asynccontextmanager
async def lifespan(app):
    init_db()
    stop = asyncio.Event()
    task = asyncio.create_task(run(stop)) if settings.worker_enabled else None
    app.state.worker_task = task
    if task:

        def worker_done(completed):
            if not stop.is_set():
                logging.error("Worker exited unexpectedly; terminating for process supervisor restart")
                if not completed.cancelled():
                    logging.error("Worker result: %r", completed.exception())
                os.kill(os.getpid(), signal.SIGTERM)

        task.add_done_callback(worker_done)
    yield
    stop.set()
    if task:
        try:
            await asyncio.wait_for(task, 20)
        except TimeoutError:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass


app = FastAPI(title="JobHunt Agent", lifespan=lifespan, docs_url=None, redoc_url=None)
templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))


@app.middleware("http")
async def security_headers(request, call_next):
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        # Forms are same-origin, and all mutations require a custom CSRF value derived from the secret.
        if request.headers.get("sec-fetch-site") == "cross-site":
            return JSONResponse({"detail": "Cross-site mutation blocked"}, status_code=403)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; style-src 'self' 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"
    )
    return response


def csrf_check(value):
    import hashlib

    expected = hashlib.sha256((settings.dashboard_token + ":csrf").encode()).hexdigest()
    if not hmac.compare_digest(value, expected):
        raise HTTPException(403, "Invalid CSRF token")


@app.get("/healthz")
def health():
    with Session() as s:
        s.execute(text("SELECT 1"))
    task = getattr(app.state, "worker_task", None)
    if settings.worker_enabled and (task is None or task.done()):
        raise HTTPException(503, "Worker is not running")
    return {"status": "ok"}


@app.get("/", response_class=HTMLResponse, dependencies=[Depends(auth)])
def dashboard(request: Request, status: str = ""):
    import hashlib

    with Session() as s:
        q = select(Job).order_by(Job.updated_at.desc()).limit(200)
        if status:
            q = q.where(Job.status == status)
        jobs = s.scalars(q).all()
        counts = dict(s.execute(select(Job.status, func.count()).group_by(Job.status)).all())
        sources = s.scalars(select(Source).order_by(Source.id.desc()).limit(30)).all()
        events = s.scalars(select(Event).order_by(Event.id.desc()).limit(20)).all()
        return templates.TemplateResponse(
            request=request,
            name="dashboard.html",
            context={
                "jobs": jobs,
                "counts": counts,
                "sources": sources,
                "events": events,
                "today": count_today(s),
                "limit": settings.daily_limit,
                "auto": settings.auto_submit,
                "csrf": hashlib.sha256((settings.dashboard_token + ":csrf").encode()).hexdigest(),
                "status": status,
            },
        )


@app.get("/api/stats", dependencies=[Depends(auth)])
def stats():
    with Session() as s:
        return {
            "statuses": dict(s.execute(select(Job.status, func.count()).group_by(Job.status)).all()),
            "daily_capacity_used": count_today(s),
            "daily_limit": settings.daily_limit,
        }


@app.post("/sources", dependencies=[Depends(auth)])
async def add_source(url: str = Form(), csrf: str = Form()):
    csrf_check(csrf)
    await safe_url(url)
    remember_source(url)
    return RedirectResponse("/", 303)


@app.post("/jobs/{job_id}/review", dependencies=[Depends(auth)])
def review_job(job_id: int, action: str = Form(), note: str = Form(""), csrf: str = Form()):
    csrf_check(csrf)
    with Session.begin() as s:
        job = s.get(Job, job_id)
        if not job or job.status not in {"review", "failed"}:
            raise HTTPException(409, "Job is not awaiting review")
        application = s.scalar(select(Application).where(Application.job_id == job_id))
        uncertain = application and application.state in {"submission_intent", "uncertain", "submitted"}
        if action == "queue":
            if uncertain:
                raise HTTPException(
                    409, "Submission may have happened. Reconcile with evidence; automatic retry is blocked."
                )
            job.status, job.next_attempt, job.attempts = "queued", now(), 0
        elif action == "reject":
            job.status = "rejected"
        elif action == "confirm_submitted":
            if not application or not note.strip():
                raise HTTPException(400, "A manual confirmation reference is required")
            application.state, application.submitted_at = "submitted", now()
            application.evidence = {**application.evidence, "manual_confirmation": note}
            job.status = "submitted"
        else:
            raise HTTPException(400, "Unknown action")
        job.reason, job.updated_at = note, now()
        event(s, "manual_review", job_id, action=action, note=note)
    return RedirectResponse("/", 303)


@app.get("/jobs/{job_id}/evidence", dependencies=[Depends(auth)])
def evidence(job_id: int):
    with Session() as s:
        application = s.scalar(select(Application).where(Application.job_id == job_id))
        return {
            "application": application.state if application else None,
            "evidence": application.evidence if application else {},
            "events": [
                {"kind": e.kind, "at": e.created_at.isoformat(), "detail": e.detail}
                for e in s.scalars(select(Event).where(Event.job_id == job_id).order_by(Event.id))
            ],
        }


@app.get("/jobs/{job_id}/screenshot/{name}", dependencies=[Depends(auth)])
def evidence_image(job_id: int, name: str):
    if name not in {"before-submit.png", "confirmation.png", "review.png"}:
        raise HTTPException(404)
    path = settings.data_dir / "evidence" / str(job_id) / name
    if not path.is_file():
        raise HTTPException(404)
    return FileResponse(path)
