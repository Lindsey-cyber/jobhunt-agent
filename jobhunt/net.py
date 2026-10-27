import asyncio
import ipaddress
import socket
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

import httpx

from jobhunt.settings import settings

USER_AGENT = "JobHuntAgent/0.1"


async def safe_url(url):
    p = urlsplit(url)
    if p.scheme not in {"http", "https"} or not p.hostname or p.username or p.password:
        raise ValueError("Unsafe URL")
    if settings.allow_local_test_urls and p.hostname in {"127.0.0.1", "localhost"}:
        return
    infos = await asyncio.get_running_loop().getaddrinfo(p.hostname, p.port or 443, type=socket.SOCK_STREAM)
    if any(not ipaddress.ip_address(i[4][0]).is_global for i in infos):
        raise ValueError("Private or reserved network target blocked")


class Web:
    def __init__(self):
        self.client = httpx.AsyncClient(
            timeout=30, headers={"User-Agent": USER_AGENT}, follow_redirects=False
        )
        self.robots = {}

    async def close(self):
        await self.client.aclose()

    async def request(self, method, url, **kwargs):
        from urllib.parse import urljoin

        for redirect in range(6):
            await safe_url(url)
            for attempt in range(settings.http_retries + 1):
                try:
                    r = await self.client.request(method, url, **kwargs)
                    if r.status_code not in {429, 500, 502, 503, 504} or attempt == settings.http_retries:
                        break
                    delay = retry_delay(r.headers.get("retry-after"), attempt)
                except (httpx.TimeoutException, httpx.NetworkError):
                    if attempt == settings.http_retries:
                        raise
                    delay = min(30, 2**attempt)
                await asyncio.sleep(delay)
            if r.is_redirect:
                target = urljoin(url, r.headers["location"])
                if urlsplit(url).scheme == "https" and urlsplit(target).scheme != "https":
                    raise ValueError("HTTPS downgrade blocked")
                if (urlsplit(target).scheme, urlsplit(target).netloc) != (
                    urlsplit(url).scheme,
                    urlsplit(url).netloc,
                ):
                    kwargs.pop("headers", None)  # Never forward provider credentials cross-origin.
                kwargs.pop("params", None)
                if method != "GET":
                    raise ValueError("Unexpected redirect on a read-only POST endpoint")
                url = target
                continue
            r.raise_for_status()
            if len(r.content) > 8_000_000:
                raise ValueError("Response too large")
            return r
        raise ValueError("Too many redirects")

    async def get(self, url, **kwargs):
        return await self.request("GET", url, **kwargs)

    async def post_read(self, url, **kwargs):
        """Retry-safe read endpoints ONLY. Never used for application submission."""
        return await self.request("POST", url, **kwargs)

    async def allowed(self, url):
        p = urlsplit(url)
        origin = f"{p.scheme}://{p.netloc}"
        if origin not in self.robots:
            try:
                r = await self.get(origin + "/robots.txt")
                rp = RobotFileParser()
                rp.parse(r.text.splitlines())
                self.robots[origin] = rp
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 404:
                    self.robots[origin] = None
                else:
                    return False
            except Exception:
                return False
        rp = self.robots[origin]
        return rp is None or rp.can_fetch(USER_AGENT, url)


def retry_delay(value, attempt):
    if value:
        try:
            return max(0, min(30, float(value)))
        except ValueError:
            try:
                return max(
                    0, min(30, (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds())
                )
            except (ValueError, TypeError):
                pass
    return min(30, 2**attempt)
