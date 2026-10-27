import asyncio
import ipaddress
import socket
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

    async def get(self, url, **kwargs):
        from urllib.parse import urljoin

        for _ in range(6):
            await safe_url(url)
            r = await self.client.get(url, **kwargs)
            if r.is_redirect:
                url = urljoin(url, r.headers["location"])
                continue
            r.raise_for_status()
            if len(r.content) > 8_000_000:
                raise ValueError("Response too large")
            return r
        raise ValueError("Too many redirects")

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
