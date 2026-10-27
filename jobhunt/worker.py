import asyncio
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import and_, func, or_, select, text

from jobhunt.browser import Review, apply
from jobhunt.db import Application, Job, Session, State, engine, event, now
from jobhunt.discovery import discover
from jobhunt.settings import settings

log = logging.getLogger(__name__)


def day_start():
    local = datetime.now(ZoneInfo(settings.timezone))
    return (
        local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).replace(tzinfo=None)
    )


def count_today(s):
    # Uncertain side effects consume capacity too; avoids exceeding the cap after a crash.
    return s.scalar(
        select(func.count())
        .select_from(Application)
        .where(
            or_(
                and_(Application.state == "submitted", Application.submitted_at >= day_start()),
                and_(
                    Application.state.in_(["submission_intent", "uncertain"]),
                    Application.intent_at >= day_start(),
                ),
            )
        )
    )


def recover():
    with Session.begin() as s:
        for job in s.scalars(select(Job).where(Job.status == "applying")):
            app = s.scalar(select(Application).where(Application.job_id == job.id))
            if app and app.state in {"submission_intent", "uncertain"}:
                app.state = "uncertain"
                job.status, job.reason = "review", "Interrupted after submission intent; reconcile manually"
            elif app and app.state == "submitted":
                job.status = "submitted"
            else:
                job.status, job.reason = "queued", "Recovered preparation after crash"
            job.updated_at = now()


def daily_report(s):
    # Report the completed local calendar day; keep a current snapshot in the dashboard.
    local = datetime.now(ZoneInfo(settings.timezone))
    day = str((local - timedelta(days=1)).date())
    previous = s.get(State, "report")
    if previous and previous.value.get("day") == day:
        return
    counts = dict(s.execute(select(Job.status, func.count()).group_by(Job.status)).all())
    end = day_start()
    start = (
        (local.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1))
        .astimezone(timezone.utc)
        .replace(tzinfo=None)
    )
    submitted = s.scalar(
        select(func.count())
        .select_from(Application)
        .where(
            Application.submitted_at >= start,
            Application.submitted_at < end,
            Application.state == "submitted",
        )
    )
    discovered = s.scalar(
        select(func.count()).select_from(Job).where(Job.discovered_at >= start, Job.discovered_at < end)
    )
    report = {
        "day": day,
        "timezone": settings.timezone,
        "current_status_counts": counts,
        "submitted": submitted,
        "discovered": discovered,
    }
    path = settings.data_dir / "reports"
    path.mkdir(exist_ok=True)
    import json

    (path / f"{day}.json").write_text(json.dumps(report, indent=2))
    if previous:
        previous.value = report
    else:
        s.add(State(key="report", value=report))
    event(s, "daily_report", **report)


def claim():
    with Session.begin() as s:
        if count_today(s) >= max(0, settings.daily_limit):
            return None
        job = s.scalar(
            select(Job)
            .where(Job.status == "queued", Job.next_attempt <= now())
            .order_by(Job.posted_at.desc().nullslast(), Job.discovered_at.desc())
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if not job:
            return None
        app = s.scalar(select(Application).where(Application.job_id == job.id))
        if app and app.state in {"submitted", "submission_intent", "uncertain"}:
            job.status, job.reason = "review", "Existing submission record blocks retry"
            return None
        if not app:
            s.add(Application(job_id=job.id))
        else:
            app.state = "preparing"
            app.created_at = now()
        job.status, job.updated_at = "applying", now()
        job.attempts += 1
        event(s, "application_started", job.id, attempt=job.attempts)
        return job


def before_submit():
    with Session() as s:
        if count_today(s) >= settings.daily_limit:
            raise Review("Daily cap reached")


def record_failure(job_id, exc):
    with Session.begin() as s:
        job = s.get(Job, job_id)
        app = s.scalar(select(Application).where(Application.job_id == job_id))
        if app and app.state == "submitted":
            job.status = "submitted"
            event(s, "post_submission_cleanup_failed", job_id, reason=str(exc)[:1500])
            return
        uncertain = app and app.state in {"submission_intent", "uncertain"}
        if uncertain:
            app.state = "uncertain"
        job.status = (
            "review"
            if uncertain or isinstance(exc, Review)
            else ("failed" if job.attempts >= settings.max_attempts else "queued")
        )
        job.reason = str(exc)[:1500]
        job.updated_at = now()
        job.next_attempt = now() + timedelta(seconds=min(3600, 60 * 2**job.attempts))
        event(s, "application_" + job.status, job.id, reason=job.reason)


async def run(stop):
    # Dedicated connection holds a singleton worker lock for the lifetime of the process.
    lock = engine.connect()
    try:
        if engine.dialect.name == "postgresql":
            if not lock.scalar(text("SELECT pg_try_advisory_lock(742019384)")):
                log.error("Another worker owns the database lock")
                return
            lock.commit()
        recover()
        while not stop.is_set():
            # Losing this connection loses the lock: stop rather than operating concurrently.
            lock.execute(text("SELECT 1"))
            lock.commit()
            try:
                with Session.begin() as s:
                    beat = s.get(State, "worker")
                    value = {"heartbeat": now().isoformat()}
                    if beat:
                        beat.value = value
                    else:
                        s.add(State(key="worker", value=value))
                    daily_report(s)
                    last = s.get(State, "discovery")
                    due = (
                        not last
                        or (now() - datetime.fromisoformat(last.value["at"])).total_seconds()
                        >= settings.discovery_interval
                    )
                if due:
                    await asyncio.wait_for(discover(), timeout=600)
                    with Session.begin() as s:
                        last = s.get(State, "discovery")
                        if last:
                            last.value = {"at": now().isoformat()}
                        else:
                            s.add(State(key="discovery", value={"at": now().isoformat()}))
                job = claim()
                if job:
                    try:
                        await asyncio.wait_for(apply(job, before_submit), timeout=900)
                    except Exception as exc:
                        log.warning("Application %s: %s", job.id, exc)
                        record_failure(job.id, exc)
            except Exception:
                log.exception("Worker tick failed")
            try:
                await asyncio.wait_for(stop.wait(), timeout=settings.poll_interval)
            except TimeoutError:
                pass
    finally:
        lock.close()
