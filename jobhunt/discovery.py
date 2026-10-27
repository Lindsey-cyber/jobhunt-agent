import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from urllib.parse import parse_qs, urljoin, urlsplit

from bs4 import BeautifulSoup
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError

from jobhunt.criteria import evaluate, text
from jobhunt.db import Job, Session, Source, State, canonical_url, event, fingerprint, now
from jobhunt.net import Web
from jobhunt.settings import settings

log = logging.getLogger(__name__)
ROLES = [
    "machine learning engineer",
    "AI engineer",
    "LLM engineer",
    "data engineer",
    "ML infrastructure engineer",
    "ML platform engineer",
    "research engineer",
    "ML training engineer",
    "applied AI engineer",
]
SITES = [
    "",
    "site:boards.greenhouse.io",
    "site:jobs.lever.co",
    "site:jobs.ashbyhq.com",
    "site:myworkdayjobs.com",
    "careers",
    "site:jobs.smartrecruiters.com",
    "site:recruitee.com",
    '"remote"',
    '"relocation"',
]


def source_for(url):
    p = urlsplit(url)
    parts = p.path.strip("/").split("/")
    host = p.hostname or ""
    if host in {"boards.greenhouse.io", "job-boards.greenhouse.io", "boards.eu.greenhouse.io"} and parts[0]:
        slug = parse_qs(p.query).get("for", [parts[0]])[0] if parts[0] == "embed" else parts[0]
        return "greenhouse", f"https://{host}/{slug}"
    if host in {"jobs.lever.co", "jobs.eu.lever.co"} and parts[0]:
        return "lever", f"https://{host}/{parts[0]}"
    if host == "jobs.ashbyhq.com" and parts[0]:
        return "ashby", f"https://{host}/{parts[0]}"
    if host.endswith(".myworkdayjobs.com"):
        # Public Workday boards are /<locale>/<board>/job/... or /<board>/job/...
        start = 1 if re.fullmatch(r"[a-z]{2}-[A-Z]{2}", parts[0]) else 0
        board_name = parts[start] if len(parts) > start else ""
        return "workday", f"{p.scheme}://{host}/{board_name}"
    if host in {"jobs.smartrecruiters.com", "careers.smartrecruiters.com"} and parts[0]:
        return "smartrecruiters", f"https://careers.smartrecruiters.com/{parts[0]}"
    if host.endswith(".recruitee.com"):
        return "recruitee", f"https://{host}"
    return "career", canonical_url(url)


def remember_source(url):
    kind, canonical = source_for(url)
    try:
        with Session.begin() as s:
            if not s.scalar(select(Source).where(Source.url == canonical)):
                s.add(Source(url=canonical, kind=kind))
    except IntegrityError:
        pass


def parse_date(value):
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value / 1000, timezone.utc).replace(tzinfo=None)
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc).replace(tzinfo=None) if parsed.tzinfo else parsed
    except (ValueError, TypeError, AttributeError):
        return None


def store_job(company, title, url, location="", description="", posted=None, source=""):
    if not company or not title or not url:
        return False
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        return False
    url = canonical_url(url)
    fp = fingerprint(company, title)
    status, reason = evaluate(title, location, description)
    try:
        with Session.begin() as s:
            if s.scalar(select(Job.id).where(or_(Job.url == url, Job.fingerprint == fp))):
                return False
            s.add(
                Job(
                    company=company[:300],
                    title=title[:500],
                    url=url,
                    fingerprint=fp,
                    location=location,
                    description=text(description),
                    posted_at=parse_date(posted),
                    source=source,
                    status=status,
                    reason=reason,
                )
            )
        return True
    except IntegrityError:
        return False


async def search(web):
    if not (settings.brave_api_key or settings.tavily_api_key):
        return
    with Session.begin() as s:
        state = s.get(State, "search_cursor")
        cursor = state.value.get("cursor", 0) if state else 0
        if not state:
            state = State(key="search_cursor", value={})
            s.add(state)
        state.value = {"cursor": cursor + settings.search_queries_per_cycle}
    for i in range(cursor, cursor + settings.search_queries_per_cycle):
        query = f'{ROLES[i % len(ROLES)]} ("new grad" OR "entry level" OR junior) "United States" {SITES[(i // len(ROLES)) % len(SITES)]}'
        for provider in ["brave", "tavily"]:
            if not getattr(settings, provider + "_api_key"):
                continue
            try:
                if provider == "brave":
                    r = await web.get(
                        "https://api.search.brave.com/res/v1/web/search",
                        params={
                            "q": query,
                            "count": 20,
                            "country": "US",
                            "freshness": "pm",
                            "offset": (i // (len(ROLES) * len(SITES))) % 3,
                        },
                        headers={"X-Subscription-Token": settings.brave_api_key},
                    )
                    urls = [x["url"] for x in r.json().get("web", {}).get("results", [])]
                else:
                    r = await web.post_read(
                        "https://api.tavily.com/search",
                        headers={"Authorization": f"Bearer {settings.tavily_api_key}"},
                        json={"query": query, "max_results": 20, "search_depth": "advanced"},
                    )
                    urls = [x["url"] for x in r.json().get("results", [])]
                for url in urls:
                    if urlsplit(url).scheme in {"https", "http"}:
                        remember_source(url)
            except Exception as exc:
                log.warning("Search provider %s failed: %s", provider, type(exc).__name__)
                with Session.begin() as s:
                    event(s, "search_failed", provider=provider, error=type(exc).__name__)


async def board(web, source):
    p = urlsplit(source.url)
    slug = p.path.strip("/").split("/")[0]
    if source.kind == "greenhouse":
        host = "boards-api.eu.greenhouse.io" if ".eu." in p.netloc else "boards-api.greenhouse.io"
        data = (await web.get(f"https://{host}/v1/boards/{slug}/jobs", params={"content": "true"})).json()
        for j in data.get("jobs", []):
            store_job(
                slug,
                j["title"],
                j["absolute_url"],
                j.get("location", {}).get("name", ""),
                j.get("content", ""),
                j.get("updated_at"),
                source.url,
            )
    elif source.kind == "lever":
        host = "api.eu.lever.co" if ".eu." in p.netloc else "api.lever.co"
        offset = 0
        while True:
            data = (
                await web.get(
                    f"https://{host}/v0/postings/{slug}",
                    params={"mode": "json", "skip": offset, "limit": 100},
                )
            ).json()
            for j in data:
                desc = (
                    j.get("descriptionPlain", "")
                    + " "
                    + " ".join(x.get("content", "") for x in j.get("lists", []))
                    + " "
                    + j.get("additionalPlain", "")
                )
                store_job(
                    slug,
                    j["text"],
                    j["hostedUrl"],
                    j.get("categories", {}).get("location", ""),
                    desc,
                    j.get("createdAt"),
                    source.url,
                )
            if len(data) < 100 or offset >= 5000:
                break
            offset += 100
    elif source.kind == "ashby":
        data = (await web.get(f"https://api.ashbyhq.com/posting-api/job-board/{slug}")).json()
        for j in data.get("jobs", []):
            if j.get("isListed", True):
                store_job(
                    slug,
                    j["title"],
                    j["jobUrl"],
                    j.get("location", "")
                    + " "
                    + str(j.get("address", ""))
                    + " "
                    + str(j.get("secondaryLocations", "")),
                    j.get("descriptionHtml", ""),
                    j.get("publishedAt"),
                    source.url,
                )
    elif source.kind == "workday":
        await workday(web, source.url)
    elif source.kind in {"smartrecruiters", "recruitee"}:
        from jobhunt import ats

        await getattr(ats, source.kind)(web, source.url, store_job)
    else:
        await career(web, source.url)


async def workday(web, url):
    """Workday public career-site JSON. Unsupported tenant variants fall back to structured HTML."""
    if not await web.allowed(url):
        raise ValueError("robots.txt blocks Workday access or could not be verified")
    p = urlsplit(url)
    tenant = p.netloc.split(".")[0]
    board_name = p.path.strip("/").split("/")[0]
    base = f"{p.scheme}://{p.netloc}/wday/cxs/{tenant}/{board_name}"
    for offset in range(0, 5000, 20):
        endpoint = base + "/jobs"
        from jobhunt.net import safe_url

        await safe_url(endpoint)
        r = await web.post_read(
            endpoint, json={"appliedFacets": {}, "limit": 20, "offset": offset, "searchText": ""}
        )
        if r.status_code in {404, 405}:
            await career(web, url)
            return
        r.raise_for_status()
        data = r.json()
        postings = data.get("jobPostings", [])
        for item in postings:
            path = item.get("externalPath", "")
            if not path.startswith("/job/"):
                continue
            detail = (await web.get(base + path)).json().get("jobPostingInfo", {})
            store_job(
                tenant,
                item.get("title", ""),
                url.rstrip("/") + path,
                detail.get("location", item.get("locationsText", "")) + " " + str(detail.get("country", "")),
                detail.get("jobDescription", ""),
                detail.get("startDate"),
                url,
            )
        if not postings or offset + len(postings) >= data.get("total", 0):
            break


async def career(web, url):
    if not await web.allowed(url):
        raise ValueError("robots.txt blocks crawling or could not be verified")
    r = await web.get(url)
    if "xml" in r.headers.get("content-type", "") or r.text.lstrip().startswith("<?xml"):
        for match in re.findall(r"<loc>\s*([^<]+)\s*</loc>", r.text)[:500]:
            link = match.strip().replace("&amp;", "&")
            if urlsplit(link).netloc == urlsplit(url).netloc and re.search(
                r"career|job|position|opening|sitemap", link, re.I
            ):
                remember_source(link)
        return
    soup = BeautifulSoup(r.text, "html.parser")

    def walk(obj):
        if isinstance(obj, list):
            for child in obj:
                walk(child)
        elif isinstance(obj, dict):
            types = obj.get("@type", [])
            if types == "ListItem" and isinstance(obj.get("url"), str):
                link = urljoin(url, obj["url"])
                if urlsplit(link).netloc == urlsplit(url).netloc:
                    remember_source(link)
            if types == "JobPosting" or isinstance(types, list) and "JobPosting" in types:
                org = obj.get("hiringOrganization", {})
                locations = obj.get("jobLocation", [])
                locations = locations if isinstance(locations, list) else [locations]
                loc = " ".join(str(x.get("address", "")) for x in locations if isinstance(x, dict))
                loc += " " + str(obj.get("applicantLocationRequirements", ""))
                store_job(
                    org.get("name", "") if isinstance(org, dict) else str(org),
                    obj.get("title", ""),
                    urljoin(url, obj.get("url", url)),
                    loc,
                    obj.get("description", ""),
                    obj.get("datePosted"),
                    url,
                )
            for child in obj.values():
                if isinstance(child, (dict, list)):
                    walk(child)

    for script in soup.select('script[type="application/ld+json"]'):
        try:
            walk(json.loads(script.string or script.get_text()))
        except (ValueError, TypeError):
            continue
    for a in soup.select("a[href],iframe[src],link[rel='sitemap']")[:500]:
        link = urljoin(str(r.url), a.get("href", a.get("src", "")))
        if urlsplit(link).scheme not in {"http", "https"}:
            continue
        kind, _ = source_for(link)
        if kind != "career" or (
            urlsplit(link).netloc == urlsplit(url).netloc
            and re.search(r"job|career|position|opening|sitemap", link, re.I)
        ):
            remember_source(link)


async def discover():
    web = Web()
    try:
        await search(web)
        with Session() as s:
            sources = s.scalars(
                select(Source)
                .order_by(Source.last_checked.asc().nullsfirst())
                .limit(settings.sources_per_cycle)
            ).all()

        async def poll_source(source):
            if source.last_checked and (now() - source.last_checked).total_seconds() < min(
                86400, settings.discovery_interval * 2 ** min(source.failures, 5)
            ):
                return
            try:
                async with semaphore:
                    await asyncio.wait_for(board(web, source), timeout=90)
                error = ""
            except Exception as e:
                error = f"{type(e).__name__}: {str(e)[:300]}"
                log.warning("Source %s: %s", source.id, error)
            with Session.begin() as s:
                row = s.get(Source, source.id)
                row.last_checked = now()
                row.error = error
                row.failures = row.failures + 1 if error else 0

        semaphore = asyncio.Semaphore(settings.discovery_concurrency)
        await asyncio.gather(*(poll_source(source) for source in sources))
        with Session.begin() as s:
            event(s, "discovery_complete", sources=len(sources))
    finally:
        await web.close()
