"""Public feed parsers and explicit, read-only email import. No scraping restricted boards."""

import base64
import json
import re
import zlib
from urllib.parse import parse_qs, unquote, urlsplit, urlunsplit

from bs4 import BeautifulSoup

from jobhunt.criteria import ROLE, text
from jobhunt.identity import posting_key


def links(value):
    soup = BeautifulSoup(value, "html.parser")
    result = [a.get("href", "") for a in soup.select("a[href]")]
    result += re.findall(r"\]\((https?://[^\s)]+)\)", value)
    return list(dict.fromkeys(x for x in result if x.startswith(("https://", "http://"))))


def github_jobs(content, source_url):
    """Parse HTML and Markdown tables. Repo dates are third-party dates, never official."""
    result, company = [], ""
    tables = []
    for tr in BeautifulSoup(content, "html.parser").select("tr"):
        cells = tr.find_all("td", recursive=False)
        if len(cells) >= 4:
            tables.append([str(c) for c in cells])
    for line in content.splitlines():
        if line.strip().startswith("|"):
            cells = line.strip().strip("|").split("|")
            if len(cells) >= 4 and not re.fullmatch(r"[-: ]+", cells[0]):
                tables.append(cells)
    for cells in tables:
        name = text(cells[0]).strip().replace("🔥", "").strip()
        name = re.sub(r"\[([^]]+)\]\([^)]+\)", r"\1", name).replace("**", "")
        if name not in {"↳", "↪", "", "↳ "}:
            company = name
        title = text(cells[1]).strip().replace("**", "")
        title = re.sub(r"\[([^]]+)\]\([^)]+\)", r"\1", title)
        if not company or company.lower() == "company" or not title:
            continue
        candidates = links(" ".join(cells[3:]))
        candidates = [
            u
            for u in candidates
            if not any(d in urlsplit(u).netloc for d in ["imgur.com", "simplify.jobs", "github.com"])
        ]
        # Prefer the employer apply anchor; absence remains an unresolved lead.
        if not candidates:
            continue
        result.append(
            {
                "company": company,
                "title": title,
                "location": text(cells[2]),
                "url": candidates[0],
                "application_url": candidates[0],
                "description": "",
                "source_url": source_url,
                "reported_date": text(cells[-1]),
                "source_date_kind": "repository_reported_age",
                "closed_hint": "🔒" in " ".join(cells),
                "early_career_source": "new grad" in content[:250].casefold(),
                "official": False,
            }
        )
    return result


def clean_alert_url(value):
    """Only decode explicit embedded destinations; never follow personalized tracking links."""
    for _ in range(4):
        p = urlsplit(value)
        if p.hostname in {"urldefense.com", "urldefense.proofpoint.com"}:
            match = re.search(r"/v3/__(https?://.*?)__;", value)
            if match:
                # Proofpoint URL Defense wraps a literal destination before its signature.
                value = match.group(1).replace("*", "%")
                continue
        if p.hostname == "email.g.joinhandshake.com" and p.path.startswith("/c/"):
            try:
                token = p.path.removeprefix("/c/")
                decoded = (
                    zlib.decompressobj()
                    .decompress(base64.urlsafe_b64decode(token + "==="), 65536)
                    .decode("utf-8", "replace")
                )
                match = re.search(r"https://(?:app\.)?joinhandshake\.com/(?:stu/)?jobs/\d+", decoded)
                return match.group(0) if match else ""
            except (ValueError, zlib.error):
                return ""
        q = parse_qs(p.query)
        embedded = next(
            (q[k][0] for k in ["url", "jobUrl", "job_url", "redirect", "destination"] if q.get(k)), ""
        )
        if embedded.startswith(("http://", "https://")):
            value = unquote(embedded)
            continue
        if p.hostname and p.hostname.endswith("linkedin.com") and re.search(r"/jobs/view/\d+", p.path):
            return "https://www.linkedin.com" + re.search(r"/jobs/view/\d+", p.path).group(0)
        if (
            p.hostname
            and p.hostname.endswith("joinhandshake.com")
            and re.search(r"/(?:stu/)?jobs/\d+", p.path)
        ):
            return "https://app.joinhandshake.com" + re.search(r"/(?:stu/)?jobs/\d+", p.path).group(0)
        if p.hostname and (p.hostname.endswith("indeed.com") or p.hostname.endswith("glassdoor.com")):
            if q.get("jk"):
                return f"https://www.indeed.com/viewjob?jk={q['jk'][0]}"
            if q.get("jobListingId"):
                return f"https://www.glassdoor.com/job-listing/-JV.htm?jobListingId={q['jobListingId'][0]}"
        if any(
            x in (p.hostname or "") for x in ["greenhouse.io", "lever.co", "ashbyhq.com", "myworkdayjobs.com"]
        ):
            return urlunsplit((p.scheme, p.netloc, p.path, "", ""))
        return ""
    return ""


def email_bodies(payload):
    body = payload.get("body") or {}
    if payload.get("mime_type", payload.get("mimeType", "")) in {"text/html", "text/plain"}:
        if body.get("content"):
            yield body["content"]
        elif body.get("data") or body.get("base64_url_content"):
            yield base64.urlsafe_b64decode((body.get("data") or body["base64_url_content"]) + "===").decode(
                "utf-8", "replace"
            )
    for child in payload.get("parts") or []:
        yield from email_bodies(child)


def email_jobs(message):
    """Accept Gmail API payloads, or a connector's read result, without modifying mail."""
    headers = {h["name"].casefold(): h["value"] for h in message.get("payload", {}).get("headers", [])}
    sender = headers.get("from", "").casefold()
    provider = next((p for p in ["linkedin", "indeed", "glassdoor", "handshake"] if p in sender), "other")
    channel = "gmail_" + provider
    result, seen = [], set()
    for body in email_bodies(message.get("payload", {})):
        soup = BeautifulSoup(body, "html.parser")
        for anchor in soup.select("a[href]"):
            url = clean_alert_url(anchor["href"])
            if not url:
                continue
            label = anchor.get_text(" ", strip=True)
            if not label or posting_key(url) in seen:
                continue
            seen.add(posting_key(url))
            # Preserve context for human review; never infer employer/title from marketing subject.
            parent = anchor.find_parent(["tr", "td", "div"])
            context = parent.get_text(" ", strip=True)[:1800] if parent else label
            result.append(
                {
                    "company": "Unknown — email lead",
                    "title": label or "Unresolved job alert",
                    "location": "",
                    "description": context,
                    "url": url,
                    "application_url": "",
                    "channel": channel,
                    "source_url": "https://mail.google.com/mail/u/0/#all/" + message.get("id", ""),
                    "reported_date": headers.get("date", ""),
                    "source_date_kind": "email_received_date",
                    "official": False,
                    "unresolved": True,
                }
            )
    if provider == "handshake" and not result:
        # Some Mailgun destinations are opaque. Explicit job IDs in sender metadata
        # can be kept as unresolved platform leads without requesting tracking links.
        try:
            metadata = json.loads(headers.get("x-mailgun-variables", "{}"))
            ids = metadata.get("job_ids", [])
            ids = json.loads(ids) if isinstance(ids, str) else ids
            for job_id in ids[:50]:
                if not str(job_id).isdigit():
                    continue
                result.append(
                    {
                        "company": "Unknown — Handshake alert",
                        "title": "Handshake job alert — verify role",
                        "location": "",
                        "description": "Opaque alert destination; exact role and official employer page require review.",
                        "url": f"https://app.joinhandshake.com/stu/jobs/{job_id}",
                        "application_url": "",
                        "channel": channel,
                        "source_url": "https://mail.google.com/mail/u/0/#all/" + message.get("id", ""),
                        "reported_date": headers.get("date", ""),
                        "source_date_kind": "email_received_date",
                        "official": False,
                        "unresolved": True,
                    }
                )
        except (ValueError, TypeError, AttributeError):
            pass
    return result


async def read_github(web, spec):
    url = f"https://raw.githubusercontent.com/{spec['repo']}/{spec.get('ref', 'main')}/{spec.get('path', 'README.md')}"
    response = await web.get(url)
    return github_jobs(response.text, spec["url"])


def gmail_configured():
    from jobhunt.settings import settings

    return bool(
        settings.gmail_access_token
        or (settings.gmail_client_id and settings.gmail_client_secret and settings.gmail_refresh_token)
    )


async def read_gmail(spec):
    """Optional VPS read-only OAuth integration. Never send/modify mail or log credentials."""
    from jobhunt.net import Web
    from jobhunt.settings import settings

    web = Web()  # Deliberately not PreviewWeb: mail and OAuth responses stay outside raw public captures.
    try:
        token = settings.gmail_access_token
        if not token:
            token = (
                await web.post_read(
                    "https://oauth2.googleapis.com/token",
                    data={
                        "grant_type": "refresh_token",
                        "client_id": settings.gmail_client_id,
                        "client_secret": settings.gmail_client_secret,
                        "refresh_token": settings.gmail_refresh_token,
                    },
                )
            ).json()["access_token"]
        headers = {"Authorization": "Bearer " + token}
        data = (
            await web.get(
                "https://gmail.googleapis.com/gmail/v1/users/me/messages",
                params={
                    "q": spec.get(
                        "query",
                        "newer_than:30d (from:linkedin.com OR from:indeed.com OR from:glassdoor.com OR from:joinhandshake.com)",
                    ),
                    "maxResults": min(spec.get("message_limit", 30), 100),
                },
                headers=headers,
            )
        ).json()
        records = []
        for item in data.get("messages", []):
            message = (
                await web.get(
                    "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + item["id"],
                    params={"format": "full"},
                    headers=headers,
                )
            ).json()
            records.extend(email_jobs(message))
        return records
    finally:
        await web.close()


async def read_hn(web, spec):
    # Public official Firebase API; only the most recent Who is hiring thread.
    ids = (
        (await web.get("https://hacker-news.firebaseio.com/v0/user/whoishiring.json"))
        .json()
        .get("submitted", [])
    )
    thread = None
    for item in ids[:12]:
        obj = (await web.get(f"https://hacker-news.firebaseio.com/v0/item/{item}.json")).json() or {}
        if obj.get("title", "").startswith("Ask HN: Who is hiring?"):
            thread = obj
            break
    if not thread:
        return []
    result = []
    for item in thread.get("kids", [])[: spec.get("comment_limit", 60)]:
        obj = (await web.get(f"https://hacker-news.firebaseio.com/v0/item/{item}.json")).json() or {}
        body = text(obj.get("text", ""))
        if not ROLE.search(body):
            continue
        urls = [
            u
            for u in links(obj.get("text", ""))
            if any(
                x in (urlsplit(u).hostname or "")
                for x in ["greenhouse.io", "ashbyhq.com", "lever.co", "myworkdayjobs.com"]
            )
        ]
        for url in urls or [f"https://news.ycombinator.com/item?id={item}"]:
            result.append(
                {
                    "company": body.split("|")[0][:100],
                    "title": "Hiring post — verify specific role",
                    "location": "",
                    "description": body,
                    "url": url,
                    "application_url": "",
                    "source_url": f"https://news.ycombinator.com/item?id={item}",
                    "reported_date": obj.get("time"),
                    "source_date_kind": "hiring_post_timestamp",
                    "official": False,
                    "unresolved": True,
                }
            )
    return result


def imported_jobs(path):
    data = json.loads(path.read_text())
    if not isinstance(data, list) or len(data) > 10000:
        raise ValueError("Import must be a bounded JSON array")
    return data
