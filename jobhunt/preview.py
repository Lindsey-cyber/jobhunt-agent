"""Read-only discovery runs. No application ledger, personal profile, LLM or browser actions."""

import asyncio
import csv
import hashlib
import io
import json
import re
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit
from zipfile import ZIP_DEFLATED, ZipFile

import httpx
from sqlalchemy import select

from jobhunt import discovery
from jobhunt.criteria import evaluate, text
from jobhunt.db import DiscoveryObservation, DiscoveryRun, Session, Source, canonical_url, fingerprint, now
from jobhunt.net import Web
from jobhunt.settings import settings

COLUMNS = [
    "ordinal",
    "company",
    "title",
    "location",
    "criteria_status",
    "filter_reason",
    "url",
    "application_url",
    "posted_at",
    "source_date",
    "source_date_kind",
    "observed_at",
    "source_url",
    "canonical_url",
    "duplicate_of",
    "duplicate_reason",
    "location_variant",
    "link_status",
    "http_status",
    "final_url",
    "raw_ref",
    "description",
    "identity", "posting_key", "channel", "company_size", "company_size_basis", "company_size_source",
    "experience_requirement", "first_seen", "last_verified", "earliest_source", "official_source", "attributions",
]
CLOSED = re.compile(
    r"(?:this (?:job|position|opening) (?:is |has been )?(?:no longer available|closed|filled)|job (?:not found|has expired)|no longer accepting applications|job you are looking for is no longer)",
    re.I,
)


def run_dir(run_id):
    if not re.fullmatch(r"[a-f0-9]{32}", run_id):
        raise ValueError("Invalid preview run ID")
    return settings.data_dir / "previews" / run_id


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str))
    temporary.chmod(0o600)
    temporary.replace(path)


class PreviewWeb(Web):
    def __init__(self, directory):
        super().__init__()
        self.directory, self.counter, self.last_ref = directory, 0, ""

    def redact(self, value):
        if isinstance(value, str):
            for secret in [settings.brave_api_key, settings.tavily_api_key]:
                if secret:
                    value = value.replace(secret, "[REDACTED_API_KEY]")
            return value
        if isinstance(value, dict):
            return {k: self.redact(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self.redact(v) for v in value]
        return value

    def capture(self, method, url, response=None, error=None):
        self.counter += 1
        self.last_ref = f"raw/response-{self.counter:05d}.json"
        data = {
            "method": method,
            "requested_url": url,
            "observed_at": now().isoformat() + "Z",
            "error": error,
        }
        if response is not None:
            data.update({"url": str(response.url), "status_code": response.status_code})
            try:
                data["body"] = response.json()
            except ValueError:
                data["body"] = response.text
        # Headers and request bodies are intentionally never captured (API keys stay private).
        write_json(self.directory / self.last_ref, self.redact(data))

    async def request(self, method, url, **kwargs):
        try:
            response = await super().request(method, url, **kwargs)
        except Exception as exc:
            self.capture(method, url, getattr(exc, "response", None), type(exc).__name__)
            raise
        self.capture(method, url, response)
        return response


def new_run(seed_urls=None, query_count=9, max_sources=12, max_link_checks=100, provenance="manual_preview"):
    if not 1 <= query_count <= 100 or not 1 <= max_sources <= 100 or not 0 <= max_link_checks <= 500:
        raise ValueError("Preview limits out of range")
    seeds = list(dict.fromkeys(seed_urls or []))
    if len(seeds) > 100:
        raise ValueError("At most 100 seed URLs")
    for url in seeds:
        p = urlsplit(url)
        if p.scheme not in {"http", "https"} or not p.hostname or p.username or p.password:
            raise ValueError("Seed must be a public HTTP(S) URL without credentials")
    run_id = uuid.uuid4().hex
    directory = run_dir(run_id)
    directory.mkdir(parents=True, mode=0o700)
    providers = {
        name: {
            "configured": bool(getattr(settings, name + "_api_key")),
            "requests": 0,
            "succeeded": 0,
            "errors": [],
        }
        for name in ["brave", "tavily"]
    }
    options = {
        "seeds": seeds,
        "query_count": query_count,
        "max_sources": max_sources,
        "max_link_checks": max_link_checks,
        "provenance": provenance,
        "mode": "discovery_preview",
        "application_flow": "never_invoked",
    }
    with Session.begin() as s:
        s.add(DiscoveryRun(id=run_id, providers=providers, options=options))
    write_json(directory / "request.json", options)
    return run_id


def safe_csv(value):
    value = str(value if value is not None else "")
    return "'" + value if value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")) else value


def csv_content(rows):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({k: safe_csv(row.get(k, "")) for k in COLUMNS})
    return "\ufeff" + output.getvalue()


def deduplicate(rows):
    groups, urls = {}, {}
    rank = {"matched": 0, "review": 1, "rejected": 2}
    for row in sorted(
        rows, key=lambda r: (r["link_status"] == "invalid", rank.get(r["criteria_status"], 3), r["ordinal"])
    ):
        row.update({"duplicate_of": None, "duplicate_reason": "", "location_variant": False})
        from jobhunt.identity import identity

        key = identity(row["url"])
        existing = urls.get(row["canonical_url"]) or groups.get(key)
        if existing:
            row["duplicate_of"] = existing["ordinal"]
            row["duplicate_reason"] = (
                "same_url"
                if row["canonical_url"] == existing["canonical_url"]
                else "same_posting_identity"
            )
            row["location_variant"] = (
                row["location"].strip().casefold() != existing["location"].strip().casefold()
            )
        else:
            groups[key] = row
        urls.setdefault(row["canonical_url"], row if not existing else existing)
    return [r for r in rows if r["duplicate_of"] is None]


async def check_links(web, rows, budget):
    candidates = sorted(
        rows, key=lambda r: ({"matched": 0, "review": 1, "rejected": 2}[r["criteria_status"]], r["ordinal"])
    )
    targets = {}
    for row in candidates:
        if row["canonical_url"] not in targets and len(targets) < budget:
            targets[row["canonical_url"]] = row["url"]
    sem = asyncio.Semaphore(4)

    async def check(url):
        try:
            async with sem:
                r = await asyncio.wait_for(web.get(url), 40)
            visible = text(r.text) if "html" in r.headers.get("content-type", "") else ""
            closed = CLOSED.search(visible)
            return {
                "link_status": "invalid" if closed else "valid",
                "http_status": r.status_code,
                "final_url": str(r.url),
                "link_reason": closed.group(0)
                if closed
                else "Public listing returned HTTP 200; no submission attempted",
                "checked_at": now().isoformat() + "Z",
            }
        except httpx.HTTPStatusError as exc:
            code = exc.response.status_code
            return {
                "link_status": "invalid"
                if code in {404, 410}
                else "blocked"
                if code in {401, 403, 429}
                else "unverified",
                "http_status": code,
                "final_url": str(exc.response.url),
                "link_reason": f"HTTP {code}",
            }
        except ValueError as exc:
            return {"link_status": "invalid", "http_status": None, "link_reason": str(exc)}
        except Exception as exc:
            return {"link_status": "unverified", "http_status": None, "link_reason": type(exc).__name__}

    keys = list(targets)
    results = await asyncio.gather(*(check(targets[k]) for k in keys))
    indexed = dict(zip(keys, results))
    for row in rows:
        if row["canonical_url"] in indexed:
            row.update(indexed[row["canonical_url"]])
    return indexed


async def execute_preview(run_id, external_search=None):
    with Session.begin() as s:
        run = s.get(DiscoveryRun, run_id)
        if not run or run.status != "queued":
            raise ValueError("Preview is missing or already executed")
        run.status = "running"
        options, providers = dict(run.options), json.loads(json.dumps(run.providers))
    directory = run_dir(run_id)
    web = PreviewWeb(directory)
    rows, search_results, sources, source_results = [], [], {}, []
    truncated = 0
    if external_search is not None:
        write_json(directory / "external_search.json", external_search)

    def source_found(kind, url):
        sources.setdefault(url, kind)

    def job_found(company, title, url, location="", description="", posted=None, source="", **metadata):
        nonlocal truncated
        if len(rows) >= 10000:
            truncated += 1
            return False
        status, reason = evaluate(title, location, description)
        parsed = urlsplit(url)
        invalid = (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
        )
        original_date = posted
        date = discovery.parse_date(posted)
        date_kind = metadata.get("date_kind", "unknown")
        application_url = metadata.get("application_url") or url
        ap = urlsplit(application_url)
        if ap.scheme not in {"http", "https"} or not ap.hostname or ap.username or ap.password:
            application_url = ""
        row = {
            "ordinal": len(rows) + 1,
            "company": company,
            "title": title,
            "location": location,
            "description": text(description),
            "url": url,
            "canonical_url": canonical_url(url),
            "application_url": application_url,
            "application_url_kind": "ats_reported" if metadata.get("application_url") else "public_job_page",
            "source_url": source,
            "source_date": str(original_date or ""),
            "source_date_kind": date_kind,
            "posted_at": date.isoformat() + "Z" if date and date_kind == "published_at" else "",
            "observed_at": now().isoformat() + "Z",
            "criteria_status": "matched" if status == "queued" else status,
            "filter_reason": reason,
            "fingerprint": fingerprint(company, title),
            "location_key": hashlib.sha256(
                (fingerprint(company, title) + "|" + location.casefold()).encode()
            ).hexdigest(),
            "link_status": "invalid" if invalid else "not_checked",
            "http_status": None,
            "raw_ref": web.last_ref,
            "duplicate_of": None,
            "duplicate_reason": "",
            "location_variant": False,
        }
        rows.append(row)
        with (directory / "observations.jsonl").open("a") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
        return True

    def search_found(provider, query, items, error):
        p = providers[provider]
        p["requests"] += 1
        if error:
            p["errors"].append({"query": query, "error": error})
        else:
            p["succeeded"] += 1
        for index, item in enumerate(items):
            search_results.append(
                {
                    "provider": provider,
                    "query": query,
                    "rank": index + 1,
                    "url": item.get("url", ""),
                    "raw": web.redact(item),
                    "raw_ref": web.last_ref,
                }
            )

    tokens = [
        (discovery.job_sink, discovery.job_sink.set(job_found)),
        (discovery.source_sink, discovery.source_sink.set(source_found)),
        (discovery.search_sink, discovery.search_sink.set(search_found)),
        (discovery.preview_queries, discovery.preview_queries.set(options["query_count"])),
    ]
    status, error = "complete", ""
    checked = {}
    try:
        for url in options["seeds"]:
            discovery.remember_source(url)
        with Session() as s:
            for source in s.scalars(
                select(Source).order_by(Source.last_checked.asc().nullsfirst()).limit(options["max_sources"])
            ):
                source_found(source.kind, source.url)
        await asyncio.wait_for(discovery.search(web), 420)
        visited = set()
        deadline = asyncio.get_running_loop().time() + 600
        while len(visited) < options["max_sources"] and asyncio.get_running_loop().time() < deadline:
            todo = next(((url, kind) for url, kind in sources.items() if url not in visited), None)
            if todo is None:
                break
            url, kind = todo
            visited.add(url)
            before = len(rows)
            result = {"url": url, "kind": kind, "error": ""}
            try:
                await asyncio.wait_for(discovery.board(web, Source(url=url, kind=kind)), 90)
            except Exception as exc:
                result["error"] = type(exc).__name__ + ": " + str(exc)[:250]
            result["observations"] = len(rows) - before
            source_results.append(result)
        checked = await check_links(web, rows, options["max_link_checks"])
        if not any(p["configured"] for p in providers.values()):
            status = "partial_missing_search_keys"
        elif not any(p["succeeded"] for p in providers.values()):
            status = "partial_search_failed"
    except asyncio.CancelledError:
        status, error = "interrupted", "Preview stopped before completion; raw captures retained"
    except Exception as exc:
        status, error = "failed", type(exc).__name__ + ": " + str(exc)[:300]
    finally:
        for variable, token in reversed(tokens):
            variable.reset(token)
        await web.close()
    unique = deduplicate(rows)
    stats = {
        "search_requests_attempted": sum(p["requests"] for p in providers.values()),
        "search_requests_succeeded": sum(p["succeeded"] for p in providers.values()),
        "raw_search_results": len(search_results),
        "unique_search_urls": len({canonical_url(r["url"]) for r in search_results}),
        "raw_ats_jobs": len(rows),
        "deduplicated_jobs": len(unique),
        "duplicates": len(rows) - len(unique),
        "unique_job_urls": len({r["canonical_url"] for r in rows}),
        "location_aware_unique_jobs": len({r["location_key"] for r in rows}),
        "location_variants_merged": sum(bool(r["location_variant"]) for r in rows),
        "matched_jobs": sum(
            r["criteria_status"] == "matched" and r["link_status"] != "invalid" for r in unique
        ),
        "verified_matched_jobs": sum(
            r["criteria_status"] == "matched" and r["link_status"] == "valid" for r in unique
        ),
        "review_jobs": sum(r["criteria_status"] == "review" for r in unique),
        "rejected_jobs": sum(r["criteria_status"] == "rejected" for r in unique),
        "checked_links": len(checked),
        "invalid_links": sum(r["link_status"] == "invalid" for r in checked.values()),
        "blocked_links": sum(r["link_status"] == "blocked" for r in checked.values()),
        "unverified_links": sum(r["link_status"] == "unverified" for r in checked.values()),
        "unchecked_job_urls": max(0, len({r["canonical_url"] for r in rows}) - len(checked)),
        "sources_attempted": len(source_results),
        "sources_failed": sum(bool(r["error"]) for r in source_results),
        "truncated_observations": truncated,
        "application_flows_opened": 0,
        "applications_submitted": 0,
    }
    summary = {
        "id": run_id,
        "status": status,
        "stats": stats,
        "providers": providers,
        "options": options,
        "sources": source_results,
        "error": error,
        "finished_at": now().isoformat() + "Z",
    }
    write_json(directory / "summary.json", summary)
    write_json(directory / "search_results.json", search_results)
    write_json(directory / "jobs_all.json", rows)
    write_json(directory / "jobs_deduplicated.json", unique)
    (directory / "jobs.csv").write_text(csv_content(unique), encoding="utf-8")
    (directory / "jobs_all.csv").write_text(csv_content(rows), encoding="utf-8")
    from jinja2 import Environment, FileSystemLoader, select_autoescape

    env = Environment(
        loader=FileSystemLoader(Path(__file__).parent / "templates"), autoescape=select_autoescape()
    )
    ordered = sorted(
        unique,
        key=lambda r: (
            {"matched": 0, "review": 1, "rejected": 2}[r["criteria_status"]],
            -((discovery.parse_date(r["posted_at"]) or datetime(1970, 1, 1)).timestamp()),
        ),
    )
    html = env.get_template("preview.html").render(
        run=summary,
        rows=ordered[:200],
        total_rows=len(unique),
        view="deduped",
        filter_status="all",
        standalone=True,
    )
    (directory / "report.html").write_text(html, encoding="utf-8")
    with Session.begin() as s:
        for row in rows:
            s.add(
                DiscoveryObservation(
                    run_id=run_id, ordinal=row["ordinal"], kind="ats_job", url=row["url"], data=row
                )
            )
        for index, row in enumerate(search_results):
            s.add(
                DiscoveryObservation(
                    run_id=run_id, ordinal=index + 1, kind="search_result", url=row["url"], data=row
                )
            )
        run = s.get(DiscoveryRun, run_id)
        run.options = {**run.options, "source_outcomes": source_results}
        run.status, run.stats, run.providers, run.finished_at, run.error = (
            status,
            stats,
            providers,
            now(),
            error,
        )
    return summary


def recover_previews():
    with Session.begin() as s:
        for run in s.scalars(
            select(DiscoveryRun).where(
                DiscoveryRun.status.in_(["queued", "running"]),
                DiscoveryRun.started_at < now() - timedelta(minutes=30),
            )
        ):
            run.status, run.finished_at, run.error = (
                "interrupted",
                now(),
                "Process restarted; raw files retained. Start a new preview explicitly.",
            )


def raw_archive(run_id):
    directory = run_dir(run_id)
    target = directory / "raw-captures.zip"
    with ZipFile(target, "w", ZIP_DEFLATED) as z:
        for path in directory.rglob("*"):
            if path.is_file() and path != target and not path.name.endswith(".tmp"):
                z.write(path, path.relative_to(directory))
    return target
