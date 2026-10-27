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
    parser.add_argument("command", choices=["check", "add-source", "init-db"])
    parser.add_argument("url", nargs="?")
    args = parser.parse_args()
    if args.command == "init-db":
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
                    "daily_limit": settings.daily_limit,
                    "database_backend": settings.database_url.split(":", 1)[0],
                },
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
