"""Small operator CLI: python -m jobhunt check | add-source URL | init-db."""

import argparse
import asyncio
import json

from jobhunt.browser import load_json, profile_answers
from jobhunt.db import init_db
from jobhunt.discovery import remember_source
from jobhunt.net import safe_url
from jobhunt.settings import settings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["check", "add-source", "init-db", "preview"])
    parser.add_argument("url", nargs="?")
    parser.add_argument("--seed-url", action="append", default=[])
    parser.add_argument("--seed-file")
    parser.add_argument("--queries", type=int, default=9)
    parser.add_argument("--max-sources", type=int, default=12)
    parser.add_argument("--link-checks", type=int, default=100)
    args = parser.parse_args()
    if args.command == "preview":
        from pathlib import Path

        from jobhunt.preview import execute_preview, new_run, run_dir

        init_db()
        seeds = args.seed_url
        if args.seed_file:
            seed_data = json.loads(Path(args.seed_file).read_text())
            seeds += seed_data.get("seeds", [])
        else:
            seed_data = None
        run_id = new_run(
            seeds,
            args.queries,
            args.max_sources,
            args.link_checks,
            provenance="seed_file_and_live_provider_API" if seed_data else "CLI_live_provider_API",
        )
        print("Preview run: " + run_id, flush=True)
        summary = asyncio.run(execute_preview(run_id, external_search=seed_data))
        print(json.dumps(summary, indent=2, ensure_ascii=False))
        print("Exports: " + str(run_dir(run_id)))
    elif args.command == "init-db":
        init_db()
        print("Database initialized")
    elif args.command == "add-source":
        if not args.url:
            parser.error("add-source needs a URL")
        asyncio.run(safe_url(args.url))
        init_db()
        remember_source(args.url)
        print("Source registered")
    else:
        init_db()
        policies = load_json(settings.policies_path, {}).get("sites", {})
        print(
            json.dumps(
                {
                    "openai_key_configured": bool(settings.openai_api_key),
                    "search_key_configured": bool(settings.brave_api_key or settings.tavily_api_key),
                    "resume_exists": settings.resume_path.is_file(),
                    "verified_answer_count": len(profile_answers()),
                    "permitted_site_count": sum(bool(p.get("automation_allowed")) for p in policies.values()),
                    "dashboard_password_configured": bool(settings.dashboard_token),
                    "auto_submit": settings.auto_submit,
                    "discovery_only": settings.discovery_only,
                    "daily_limit": settings.daily_limit,
                    "database_backend": settings.database_url.split(":", 1)[0],
                },
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
