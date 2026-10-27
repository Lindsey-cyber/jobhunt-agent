"""Fail closed before publishing tracked source. Never prints matched secret values."""

import re
import subprocess
from pathlib import Path

PATTERNS = [
    re.compile(x.encode())
    for x in [
        r"sk-(?:proj-)?[A-Za-z0-9_-]{20,}",
        r"gh[pousr]_[A-Za-z0-9]{20,}",
        r"github_pat_[A-Za-z0-9_]{20,}",
        r"tvly-[A-Za-z0-9_-]{20,}",
        r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
    ]
]


def violations(files, reader=None):
    bad = []
    for path in files:
        name = path.as_posix()
        if (
            (path.name.startswith(".env") and path.name != ".env.example")
            or name.startswith(("data/", "tmp/", "pw-browsers/", ".venv/"))
            or (name.startswith("config/") and not name.endswith(".example.json"))
            or path.suffix.lower() in {".pdf", ".db", ".sqlite", ".png", ".jpg", ".zip", ".pem", ".key"}
        ):
            bad.append((name, "sensitive file type/path"))
        elif any(pattern.search(reader(path) if reader else path.read_bytes()) for pattern in PATTERNS):
            bad.append((name, "credential pattern"))
    return bad


if __name__ == "__main__":
    paths = [Path(p) for p in subprocess.check_output(["git", "ls-files", "-z"]).decode().split("\0") if p]
    bad = violations(paths, reader=lambda p: subprocess.check_output(["git", "show", ":" + p.as_posix()]))
    for name, reason in bad:
        print(f"BLOCKED {name}: {reason}")
    print(f"Checked {len(paths)} tracked files; {len(bad)} violations")
    raise SystemExit(bool(bad))
