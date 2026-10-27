"""Multi-channel, attribution-preserving discovery. This module cannot apply to a job."""

import asyncio
import hashlib
import json
import logging
import re
from datetime import timedelta
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy import select

from jobhunt import discovery, feeds
from jobhunt.criteria import EARLY, ROLE, SENIOR, evaluate, text
from jobhunt.db import (
    DiscoveryObservation,
    DiscoveryRun,
    Opportunity,
    Session,
    Source,
    SourceAttribution,
    SourceMonitor,
    now,
)
from jobhunt.identity import identity, normalized_company, posting_key
from jobhunt.preview import PreviewWeb, check_links, csv_content, new_run, run_dir, write_json
from jobhunt.settings import settings

log = logging.getLogger(__name__)


def stamp(value=None):
    return (value or now()).isoformat() + "Z"


def load_registry(path=None):
    data = json.loads(Path(path or settings.discovery_registry).read_text())
    if data.get("version") != 1 or not isinstance(data.get("sources"), list):
        raise ValueError("Unsupported discovery registry")
    return data


def employer_metadata(company, registry):
    key = normalized_company(company)
    for item in registry.get("companies", []):
        if key in {normalized_company(n) for n in [item["name"], *item.get("aliases", [])]}:
            return item
    return {"name": company, "size_band": "unknown", "classification_basis": "not researched"}


def normalize(raw, spec, ordinal, registry, raw_ref=""):
    url = raw["url"]
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Job URL must be a credential-free HTTP(S) URL")
    company = spec.get("company") or raw.get("company") or "Unknown"
    employer = employer_metadata(company, registry)
    official = bool(raw.get("official", spec.get("official", False)))
    title, location, body = raw.get("title", ""), raw.get("location", ""), text(raw.get("description", ""))
    status, reason = evaluate(
        title,
        location,
        body,
        requires_sponsorship=registry.get("_requires_sponsorship"),
        unrestricted_authorization=registry.get("_unrestricted_authorization"),
    )
    if raw.get("unresolved"):
        status, reason = "review", "Unresolved alert/hiring-post lead; verify exact official posting"
    if raw.get("closed_hint"):
        status, reason = "rejected", "Source explicitly marks opening closed"
    kind = raw.get("source_date_kind", "unknown")
    original = raw.get("reported_date", "")
    date = discovery.parse_date(original)
    published = stamp(date) if official and kind == "published_at" and date else ""
    source_url = raw.get("source_url") or spec["url"]
    application_url = raw.get("application_url") or (url if official else "")
    if application_url and urlsplit(application_url).scheme not in {"http", "https"}:
        application_url = ""
    experience = re.findall(r"[^.!?\n]{0,65}\b\d+(?:\s*[-–+]\s*\d*)?\s*years?[^.!?\n]{0,110}", body, re.I)
    return {
        "ordinal": ordinal,
        "identity": identity(url),
        "posting_key": posting_key(url),
        "fingerprint": identity(url),
        "canonical_url": posting_key(url),
        "company": employer["name"],
        "title": title,
        "location": location,
        "description": body,
        "experience_requirement": " | ".join(experience[:6]) or "Not supplied/verify",
        "url": url,
        "application_url": application_url,
        "application_url_kind": "employer_reported" if official else "unverified_third_party_destination",
        "source_url": source_url,
        "channel": raw.get("channel") or spec["channel"],
        "official": official,
        "source_date": str(original or ""),
        "source_date_kind": kind,
        "posted_at": published,
        "observed_at": stamp(),
        "first_seen": "",
        "last_verified": "",
        "criteria_status": "matched" if status == "queued" else status,
        "filter_reason": reason,
        "company_size": employer.get("size_band", "unknown"),
        "company_size_basis": employer.get("classification_basis", "not researched"),
        "company_size_source": employer.get("evidence_url", ""),
        "link_status": "not_checked",
        "http_status": None,
        "raw_ref": raw_ref,
        "duplicate_of": None,
        "duplicate_reason": "",
        "location_variant": False,
        "location_key": identity(url),
        "early_career_source": raw.get("early_career_source", False),
        "closed_hint": raw.get("closed_hint", False),
        "outreach_post": spec.get("kind") == "hn",
        "attributions": [],
    }


def group_rows(rows):
    groups = {}
    for row in rows:
        groups.setdefault(row["identity"], []).append(row)
    unique = []
    for observations in groups.values():
        # An official record outranks a repository/email claim, even if the former rejects it.
        representative = max(
            observations, key=lambda r: (r["official"], bool(r["description"]), bool(r["posted_at"]))
        )
        if not representative["official"] and len({r.get("closed_hint", False) for r in observations}) > 1:
            representative["criteria_status"], representative["filter_reason"] = (
                "review",
                "Third-party sources disagree on whether the posting is closed",
            )
        credits = []
        for row in observations:
            if row is not representative:
                row["duplicate_of"] = representative["ordinal"]
                row["duplicate_reason"] = "same_verified_posting_identity"
                row["location_variant"] = row["location"] != representative["location"]
            credits.append(
                {
                    "channel": row["channel"],
                    "original_url": row["source_url"],
                    "discovered_url": row["url"],
                    "official": row["official"],
                    "observed_at": row["observed_at"],
                    "official_published_at": row["posted_at"],
                    "reported_date": row["source_date"],
                    "date_kind": row["source_date_kind"],
                    "raw_ref": row["raw_ref"],
                    "source_checked_at": row["observed_at"],
                }
            )
        representative["attributions"] = credits
        unique.append(representative)
    return unique


def persist_attribution(unique):
    """Upsert serially under the single catalog run; preserve earliest actual observation."""
    with Session.begin() as s:
        for row in unique:
            earliest_observation = min(
                discovery.parse_date(c["observed_at"]) or now() for c in row["attributions"]
            )
            existing = s.get(Opportunity, row["identity"])
            if not existing:
                existing = Opportunity(id=row["identity"], first_seen=earliest_observation)
                s.add(existing)
            existing.first_seen = min(existing.first_seen, earliest_observation)
            existing.last_seen = now()
            row["first_seen"] = stamp(existing.first_seen)
            previous = existing.payload or {}
            if previous.get("official") and not row["official"]:
                for field in [
                    "company",
                    "title",
                    "location",
                    "description",
                    "experience_requirement",
                    "application_url",
                    "application_url_kind",
                    "posted_at",
                ]:
                    row[field] = previous.get(field, row[field])
                row["criteria_status"] = "review"
                row["filter_reason"] = (
                    "Retained previous official evidence; official feed not observed in this run"
                )
            if not row.get("last_verified"):
                row["last_verified"] = previous.get("last_verified", "")
            for credit in row["attributions"]:
                prior = s.scalar(
                    select(SourceAttribution).where(
                        SourceAttribution.opportunity_id == row["identity"],
                        SourceAttribution.channel == credit["channel"],
                        SourceAttribution.original_url == credit["original_url"],
                    )
                )
                if not prior:
                    prior = SourceAttribution(
                        opportunity_id=row["identity"],
                        channel=credit["channel"],
                        original_url=credit["original_url"],
                        first_seen=discovery.parse_date(credit["observed_at"]),
                    )
                    s.add(prior)
                    s.flush()
                prior.last_seen = now()
                credit["first_seen"] = stamp(prior.first_seen)
                credit["last_seen"] = stamp(prior.last_seen)
                credit["official_page_verified_at"] = row["last_verified"]
                prior.payload = credit
            # Include historic sources no longer present in the latest feed.
            s.flush()
            all_credits = s.scalars(
                select(SourceAttribution)
                .where(SourceAttribution.opportunity_id == row["identity"])
                .order_by(SourceAttribution.first_seen, SourceAttribution.id)
            ).all()
            row["attributions"] = [dict(c.payload) for c in all_credits]
            row["earliest_source"] = all_credits[0].channel if all_credits else ""
            row["official_source"] = next(
                (c.original_url for c in all_credits if c.payload.get("official")), ""
            )
            for index, credit in enumerate(row["attributions"]):
                credit["role"] = (
                    "official_application"
                    if credit["official"]
                    else "earliest_discovery"
                    if index == 0
                    else "supporting_discovery"
                )
            existing.payload = row


def freshness(row, days):
    date = discovery.parse_date(row.get("posted_at", ""))
    return bool(date and now() - timedelta(days=days) <= date <= now())


def channel_metrics(rows, unique):
    metrics = {}
    for channel in sorted({r["channel"] for r in rows}):
        raw = [r for r in rows if r["channel"] == channel]
        ids = {r["identity"] for r in raw}
        other_ids = {r["identity"] for r in rows if r["channel"] != channel}
        represented = [r for r in unique if r["identity"] in ids]
        checked = [r for r in represented if r["link_status"] in {"valid", "invalid"}]
        metrics[channel] = {
            "raw": len(raw),
            "unique_postings": len(ids),
            "exclusive_postings": len(ids - other_ids),
            "cross_channel_shared": len(ids & other_ids),
            "duplicate_rate": round(1 - len(ids) / len(raw), 4),
            "matched": sum(r["criteria_status"] == "matched" for r in represented),
            "valid_checked": sum(r["link_status"] == "valid" for r in checked),
            "checked": len(checked),
            "valid_rate_checked": round(sum(r["link_status"] == "valid" for r in checked) / len(checked), 4)
            if checked
            else None,
            "official_published_7d": sum(freshness(r, 7) for r in represented),
            "official_published_30d": sum(freshness(r, 30) for r in represented),
            "unknown_publication": sum(not r["posted_at"] for r in represented),
            "application_outcomes": "not evaluated — discovery only",
        }
    return metrics


async def workday_candidates(web, spec, emit):
    """Bounded early-career queries, no exhaustive tenant crawl or application endpoints."""
    from urllib.parse import urlsplit

    url = spec["url"]
    if not await web.allowed(url):
        raise ValueError("Workday robots policy unavailable or restricted")
    p = urlsplit(url)
    tenant = p.netloc.split(".")[0]
    base = f"https://{p.netloc}/wday/cxs/{tenant}/{p.path.strip('/')}"
    seen = set()
    for query in spec.get("queries", ["New College Grad", "Machine Learning"]):
        for offset in range(0, spec.get("result_limit", 60), 20):
            data = (
                await web.post_read(
                    base + "/jobs",
                    json={"appliedFacets": {}, "limit": 20, "offset": offset, "searchText": query},
                )
            ).json()
            for job in data.get("jobPostings", []):
                path = job.get("externalPath", "")
                if path in seen or not path.startswith("/job/") or not ROLE.search(job.get("title", "")):
                    continue
                seen.add(path)
                detail = (await web.get(base + path)).json().get("jobPostingInfo", {})
                emit(
                    {
                        "company": spec.get("company", tenant),
                        "title": detail.get("title", job["title"]),
                        "url": url + path,
                        "application_url": detail.get("externalUrl") or url + path,
                        "location": detail.get("location", job.get("locationsText", ""))
                        + " "
                        + str(detail.get("country", "")),
                        "description": detail.get("jobDescription", ""),
                        "reported_date": detail.get("startDate", ""),
                        "source_date_kind": "start_date",
                        "official": True,
                    }
                )
            if offset + 20 >= data.get("total", 0):
                break


async def greenhouse_candidates(web, spec, emit):
    """Read the complete lightweight index, then bounded candidate details.

    Large enterprise boards can exceed the HTTP body limit with content=true.
    Index rows are retained even when detail or subsequent validation fails.
    """
    slug = urlsplit(spec["url"]).path.strip("/").split("/")[0]
    if slug == "embed":
        raise ValueError("Embedded job URL lacks an employer board identifier")
    host = "boards-api.eu.greenhouse.io" if ".eu." in spec["url"] else "boards-api.greenhouse.io"
    base = f"https://{host}/v1/boards/{slug}/jobs"
    jobs = (await web.get(base, params={"content": "false"})).json().get("jobs", [])
    emitted = []
    for job in jobs:
        raw = {
            "company": spec.get("company", slug),
            "title": job["title"],
            "url": job["absolute_url"],
            "application_url": job["absolute_url"],
            "location": job.get("location", {}).get("name", ""),
            "reported_date": job.get("updated_at"),
            "source_date_kind": "updated_at",
            "official": True,
        }
        record = emit(raw)
        if ROLE.search(job["title"]) and not SENIOR.search(job["title"]):
            record["criteria_status"], record["filter_reason"] = (
                "review",
                "Official index only; full requirements not yet retrieved",
            )
            emitted.append((job, raw, record))
    emitted.sort(key=lambda x: not bool(EARLY.search(x[0]["title"])))
    for job, raw, record in emitted[: spec.get("detail_limit", 40)]:
        try:
            detail = (await web.get(base + "/" + str(job["id"]))).json()
            raw["description"] = detail.get("content", "")
            # Re-normalize via caller with the same ordinal instead of creating a second observation.
            enriched = emit(raw, update=record)
            if not raw["description"]:
                enriched["criteria_status"], enriched["filter_reason"] = (
                    "review",
                    "Official detail did not provide requirements",
                )
        except Exception as exc:
            record["detail_error"] = type(exc).__name__


def monitor_result(spec, rows, error):
    with Session.begin() as s:
        monitor = s.get(SourceMonitor, spec["url"])
        if not monitor:
            monitor = SourceMonitor(url=spec["url"], state={}, failures=0)
            s.add(monitor)
        previous = set((monitor.state or {}).get("identities", []))
        current = {r["identity"] for r in rows}
        result = {
            "url": spec["url"],
            "kind": spec["kind"],
            "channel": spec["channel"],
            "company": spec.get("company", ""),
            "observations": len(rows),
            "error": error,
            "new_since_previous": len(current - previous),
            "missing_since_previous": len(previous - current) if not error else None,
        }
        monitor.checked_at = now()
        monitor.failures = monitor.failures + 1 if error else 0
        if not error:
            monitor.state = {
                "identities": sorted(current),
                "content_hash": hashlib.sha256(json.dumps(sorted(current)).encode()).hexdigest(),
                "spec": spec,
            }
        result["next_poll_after"] = stamp(
            now() + timedelta(seconds=min(86400, settings.catalog_interval * 2 ** min(monitor.failures, 5)))
        )
        return result


def outreach_queue(rows):
    result = []
    for row in rows:
        if row["criteria_status"] == "rejected" or not (
            row.get("outreach_post") or row["company_size"] == "small"
        ):
            continue
        emails = (
            sorted(set(re.findall(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", row["description"])))
            if row["official"] or row.get("outreach_post")
            else []
        )
        result.append(
            {
                "company": row["company"],
                "title": row["title"],
                "post_url": row["source_url"],
                "job_url": row["url"],
                "post_date": row["source_date"],
                "public_emails": emails,
                "confidence": "published in cited post; ownership unverified"
                if emails
                else "no verified public contact",
                "contact_name": "",
                "draft": f"Hello, I saw your post about {row['title']} at {row['company']}. I am interested in early-career AI/ML opportunities. [Add a verified relevant project and your actual background.] Could you point me to the right recruiting contact?",
                "status": "draft_for_user_review",
                "sent": False,
            }
        )
    return result


async def _run_catalog(registry_path=None, import_paths=(), max_sources=35, link_checks=150, force=True):
    registry = load_registry(registry_path)
    try:
        answer = json.loads(settings.profile_path.read_text()).get("answers", {}).get("sponsorship", {})
        if answer.get("verified") is True and str(answer.get("value", "")).casefold() in {"yes", "no"}:
            registry["_requires_sponsorship"] = str(answer["value"]).casefold() == "yes"
        unrestricted = (
            json.loads(settings.profile_path.read_text())
            .get("answers", {})
            .get("unrestricted_authorization", {})
        )
        if unrestricted.get("verified") is True and str(unrestricted.get("value", "")).casefold() in {
            "yes",
            "no",
        }:
            registry["_unrestricted_authorization"] = str(unrestricted["value"]).casefold() == "yes"
    except (OSError, ValueError, AttributeError):
        pass
    run_id = new_run(
        max_sources=min(100, max_sources),
        max_link_checks=min(500, link_checks),
        provenance="multi_channel_live_discovery",
    )
    directory = run_dir(run_id)
    with Session.begin() as s:
        run = s.get(DiscoveryRun, run_id)
        run.status = "running"
        run.options = {
            **run.options,
            "catalog": True,
            "registry": str(registry_path or settings.discovery_registry),
        }
    web, rows, outcomes = PreviewWeb(directory), [], []
    sources = [dict(x) for x in registry["sources"]]
    with Session() as s:
        known = {x["url"] for x in sources}
        for monitor in s.scalars(select(SourceMonitor)):
            if monitor.url not in known and monitor.state.get("spec"):
                sources.append(monitor.state["spec"])
    sources.sort(key=lambda x: -x.get("priority", 0))
    spec = {}

    def emit(raw, update=None):
        if len(rows) >= 30000:
            raise ValueError("Observation budget exceeded; increase only after reviewing coverage")
        record = normalize(
            raw,
            spec,
            update["ordinal"] if update else len(rows) + 1,
            registry,
            "" if spec["kind"] in {"gmail", "import"} else web.last_ref,
        )
        if update is not None:
            update.update(record)
            return update
        rows.append(record)
        with (directory / "observations.jsonl").open("a", encoding="utf-8") as output:
            output.write(json.dumps(record, ensure_ascii=False) + "\n")
        return record

    def sink(company, title, url, location="", description="", posted=None, source="", **metadata):
        emit(
            {
                "company": company,
                "title": title,
                "url": url,
                "location": location,
                "description": description,
                "reported_date": posted,
                "source_date_kind": metadata.get("date_kind", "unknown"),
                "application_url": metadata.get("application_url", ""),
                "source_url": source,
            }
        )
        return True

    found = []
    token = discovery.job_sink.set(sink)
    source_token = discovery.source_sink.set(lambda kind, url: found.append((kind, url)))
    checked, fatal = {}, ""
    try:
        for path in import_paths:
            for raw in feeds.imported_jobs(Path(path)):
                spec = {
                    "url": raw["source_url"],
                    "channel": raw.get("channel", "import"),
                    "kind": "import",
                    "official": False,
                }
                emit(raw)
        visited = set()
        index = 0
        while index < len(sources) and len(visited) < max_sources:
            spec = sources[index]
            index += 1
            if spec["url"] in visited:
                continue
            visited.add(spec["url"])
            if spec["kind"] == "gmail":
                spec["enabled"] = feeds.gmail_configured()
            if not spec.get("enabled", True):
                outcomes.append(
                    {
                        **spec,
                        "error": "skipped — credentials/explicit site permission not configured",
                        "observations": 0,
                        "skipped": True,
                    }
                )
                continue
            if not force:
                with Session() as s:
                    m = s.get(SourceMonitor, spec["url"])
                    if (
                        m
                        and m.checked_at
                        and now() - m.checked_at
                        < timedelta(seconds=min(86400, settings.catalog_interval * 2 ** min(m.failures, 5)))
                    ):
                        outcomes.append(
                            {
                                **spec,
                                "error": "not due — incremental monitor backoff",
                                "observations": 0,
                                "skipped": True,
                            }
                        )
                        continue
            before, error = len(rows), ""
            try:
                async with asyncio.timeout(spec.get("timeout", 100)):
                    if spec["kind"] == "gmail":
                        for raw in await feeds.read_gmail(spec):
                            emit(raw)
                    elif spec["kind"] == "github":
                        for raw in await feeds.read_github(web, spec):
                            emit(raw)
                    elif spec["kind"] == "hn":
                        for raw in await feeds.read_hn(web, spec):
                            emit(raw)
                    elif spec["kind"] == "workday":
                        await workday_candidates(web, spec, emit)
                    elif spec["kind"] == "greenhouse":
                        await greenhouse_candidates(web, spec, emit)
                    else:
                        await discovery.board(web, Source(url=spec["url"], kind=spec["kind"]))
            except Exception as exc:
                error = type(exc).__name__ + ": " + str(exc)[:220]
            outcomes.append(monitor_result(spec, rows[before:], error))
            write_json(
                directory / "progress.json",
                {"sources": outcomes, "raw_observations": len(rows), "application_flows_opened": 0},
            )
            log.warning(
                "Discovery channel=%s source=%s observations=%d error=%s",
                spec["channel"],
                spec["url"],
                len(rows) - before,
                error or "none",
            )
            # Expand only relevant postings into employer ATSs; established employers first.
            candidates = []
            for row in rows[before:]:
                if not ROLE.search(row["title"]) or row["criteria_status"] == "rejected":
                    continue
                kind, url = discovery.source_for(row["url"])
                if kind == "career" or url in visited or any(x["url"] == url for x in sources + candidates):
                    continue
                if not EARLY.search(row["title"]) and not row["early_career_source"]:
                    continue
                candidates.append(
                    {
                        "url": url,
                        "kind": kind,
                        "channel": "official_ats",
                        "official": True,
                        "company": row["company"],
                        "priority": 80 if row["company_size"] == "medium_large" else 30,
                        "discovered_from": row["source_url"],
                        "timeout": 60,
                    }
                )
            sources[index:] = sorted(sources[index:] + candidates, key=lambda x: -x.get("priority", 0))
        unique = group_rows(rows)
        checked = await check_links(web, unique, link_checks)
        for row in unique:
            if row.get("checked_at"):
                row["last_verified"] = row["checked_at"]
    except asyncio.CancelledError:
        fatal = "Interrupted; evidence retained, no application side effects"
    except Exception as exc:
        fatal = type(exc).__name__ + ": " + str(exc)[:250]
    finally:
        discovery.job_sink.reset(token)
        discovery.source_sink.reset(source_token)
        await web.close()
    unique = group_rows(rows)
    persist_attribution(unique)
    metrics = channel_metrics(rows, unique)
    matched = [r for r in unique if r["criteria_status"] == "matched" and r["link_status"] != "invalid"]
    large = sum(r["company_size"] == "medium_large" for r in matched)
    stats = {
        "raw_ats_jobs": len(rows),
        "raw_observations": len(rows),
        "deduplicated_jobs": len(unique),
        "duplicates": len(rows) - len(unique),
        "matched_jobs": len(matched),
        "verified_matched_jobs": sum(r["link_status"] == "valid" for r in matched),
        "review_jobs": sum(r["criteria_status"] == "review" for r in unique),
        "rejected_jobs": sum(r["criteria_status"] == "rejected" for r in unique),
        "checked_links": len(checked),
        "invalid_links": sum(r["link_status"] == "invalid" for r in checked.values()),
        "blocked_links": sum(r["link_status"] == "blocked" for r in checked.values()),
        "unverified_links": sum(r["link_status"] == "unverified" for r in checked.values()),
        "unchecked_job_urls": len(unique) - len(checked),
        "sources_attempted": sum(not x.get("skipped") for x in outcomes),
        "sources_failed": sum(bool(x["error"]) and not x.get("skipped") for x in outcomes),
        "sources_skipped": sum(bool(x.get("skipped")) for x in outcomes),
        "companies_observed": len({r["company"] for r in unique}),
        "companies_matched": len({r["company"] for r in matched}),
        "medium_large_matched": large,
        "medium_large_share_matched": round(large / len(matched), 4) if matched else None,
        "unknown_size_matched": sum(r["company_size"] == "unknown" for r in matched),
        "matched_published_7d": sum(freshness(r, 7) for r in matched),
        "matched_published_30d": sum(freshness(r, 30) for r in matched),
        "matched_unknown_publication": sum(not r["posted_at"] for r in matched),
        "application_flows_opened": 0,
        "applications_submitted": 0,
    }
    providers = {
        name: {"configured": bool(getattr(settings, name + "_api_key")), "requests": 0, "errors": []}
        for name in ["brave", "tavily"]
    }
    summary = {
        "id": run_id,
        "status": "failed"
        if fatal
        else "complete_with_source_gaps"
        if any(o["error"] for o in outcomes)
        else "complete",
        "stats": stats,
        "providers": providers,
        "options": {
            "catalog": True,
            "provenance": "live_multichannel_public_sources_and_explicit_imports",
            "application_flow": "never_invoked",
            "channel_metrics": metrics,
            "source_outcomes": outcomes,
        },
        "sources": outcomes,
        "error": fatal,
        "finished_at": stamp(),
    }
    for name, value in [
        ("summary", summary),
        ("jobs_all", rows),
        ("jobs_deduplicated", unique),
        ("channels", metrics),
        ("outreach", outreach_queue(unique)),
    ]:
        write_json(directory / (name + ".json"), value)
    for name, values in [("jobs.csv", unique), ("jobs_all.csv", rows), ("matched.csv", matched)]:
        (directory / name).write_text(csv_content(values), encoding="utf-8")
    from jinja2 import Environment, FileSystemLoader, select_autoescape

    ordered = sorted(
        unique,
        key=lambda r: (
            r["criteria_status"] != "matched",
            r["company_size"] != "medium_large",
            -(discovery.parse_date(r["posted_at"]) or now() - timedelta(days=36500)).timestamp(),
        ),
    )
    env = Environment(
        loader=FileSystemLoader(Path(__file__).parent / "templates"), autoescape=select_autoescape()
    )
    (directory / "report.html").write_text(
        env.get_template("preview.html").render(
            run=summary,
            rows=ordered[:200],
            total_rows=len(unique),
            standalone=True,
            view="deduped",
            filter_status="all",
        ),
        encoding="utf-8",
    )
    with Session.begin() as s:
        for row in rows:
            s.add(
                DiscoveryObservation(
                    run_id=run_id, ordinal=row["ordinal"], kind="ats_job", url=row["url"], data=row
                )
            )
        run = s.get(DiscoveryRun, run_id)
        run.status, run.stats, run.options, run.providers, run.finished_at, run.error = (
            summary["status"],
            stats,
            summary["options"],
            providers,
            now(),
            fatal,
        )
    return summary


_catalog_lock = asyncio.Lock()


async def run_catalog(*args, **kwargs):
    if _catalog_lock.locked():
        raise ValueError("A catalog discovery run is already active")
    async with _catalog_lock:
        return await _run_catalog(*args, **kwargs)


async def scheduled_catalog(stop):
    while not stop.is_set():
        try:
            await run_catalog(max_sources=45, force=False)
        except ValueError:
            pass  # Manual run in progress; retry on the next scheduled tick.
        try:
            await asyncio.wait_for(stop.wait(), settings.catalog_interval)
        except TimeoutError:
            pass
