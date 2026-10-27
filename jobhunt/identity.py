"""Strong posting identities. Titles are never sufficient evidence of identity."""

import hashlib
import re
from urllib.parse import parse_qs, urlsplit, urlunsplit

from jobhunt.db import canonical_url


def posting_key(url):
    p = urlsplit(url)
    host = (p.hostname or "").lower()
    path = p.path.rstrip("/")
    parts = path.strip("/").split("/")
    query = parse_qs(p.query)
    if host in {"boards.greenhouse.io", "job-boards.greenhouse.io", "boards.eu.greenhouse.io"}:
        match = re.search(r"/jobs/(\d+)", path)
        jid = match.group(1) if match else query.get("gh_jid", [""])[0]
        if jid:
            return f"greenhouse:{parts[0].lower()}:{jid}"
    if host in {"jobs.lever.co", "jobs.eu.lever.co", "jobs.ashbyhq.com"} and len(parts) >= 2:
        if re.fullmatch(r"[a-fA-F0-9-]{32,36}", parts[1]):
            return f"{host}:{parts[0].lower()}:{parts[1].lower()}"
    if host.endswith(".myworkdayjobs.com"):
        match = re.search(r"_((?:JR|R)[A-Za-z0-9_-]+)$", path, re.I)
        if match:
            return f"workday:{host.split('.')[0]}:{match.group(1).casefold()}"
    if host.endswith("linkedin.com"):
        match = re.search(r"/jobs/view/(?:.*-)?(\d+)", path)
        if match:
            return "linkedin:" + match.group(1)
    # Remove /application only for the ATSs above. Other query IDs remain significant.
    return canonical_url(urlunsplit((p.scheme, p.netloc, path, p.query, "")))


def identity(url):
    return hashlib.sha256(posting_key(url).encode()).hexdigest()


def normalized_company(value):
    return re.sub(r"[^a-z0-9]", "", value.casefold())
