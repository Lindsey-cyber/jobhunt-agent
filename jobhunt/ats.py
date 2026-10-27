"""Additional public ATS readers, discovered from search/career links, not a company list."""

from urllib.parse import urlsplit


async def smartrecruiters(web, url, store):
    slug = urlsplit(url).path.strip("/").split("/")[0]
    base = f"https://api.smartrecruiters.com/v1/companies/{slug}/postings"
    for offset in range(0, 5000, 100):
        data = (await web.get(base, params={"limit": 100, "offset": offset})).json()
        for item in data.get("content", []):
            detail = (await web.get(base + "/" + item["id"])).json()
            description = " ".join(
                x.get("text", "")
                for x in detail.get("jobAd", {}).get("sections", {}).values()
                if isinstance(x, dict)
            )
            location = detail.get("location", {})
            store(
                slug,
                item["name"],
                detail.get("postingUrl")
                or detail.get("applyUrl")
                or f"https://jobs.smartrecruiters.com/{slug}/{item['id']}",
                " ".join(str(location.get(k, "")) for k in ["city", "region", "country"]),
                description,
                item.get("releasedDate"),
                url,
            )
        if offset + len(data.get("content", [])) >= data.get("totalFound", 0) or not data.get("content"):
            break


async def recruitee(web, url, store):
    p = urlsplit(url)
    base = f"{p.scheme}://{p.netloc}"
    data = (await web.get(base + "/api/offers/")).json()
    for item in data.get("offers", []):
        detail = (await web.get(base + "/api/offers/" + item["slug"])).json().get("offer", item)
        store(
            p.netloc.split(".")[0],
            item["title"],
            item.get("careers_url", base + "/o/" + item["slug"]),
            " ".join(
                str(item.get(k, "")) for k in ["city", "state_name", "country", "country_code", "locations"]
            ),
            detail.get("description", "") + " " + detail.get("requirements", ""),
            item.get("published_at") or item.get("created_at"),
            url,
        )
