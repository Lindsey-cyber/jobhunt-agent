"""Native ARM64 Chromium smoke; no external page or application form is loaded."""

import asyncio
import json
import platform

from playwright.async_api import async_playwright


async def main():
    architecture = platform.machine().lower()
    if architecture not in {"aarch64", "arm64"}:
        raise RuntimeError("Native ARM64 required; do not claim x86 emulation proves A1 compatibility")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.set_content("<h1>ARM64 Chromium OK</h1>")
        assert await page.locator("h1").inner_text() == "ARM64 Chromium OK"
        print(
            json.dumps(
                {
                    "architecture": architecture,
                    "chromium": browser.version,
                    "browser_smoke": "passed",
                    "application_flows_opened": 0,
                }
            )
        )
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
