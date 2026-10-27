"""Create private local configuration without overwriting existing secrets or personal facts."""

import secrets
import shutil
from pathlib import Path


def configure(root):
    env = root / ".env"
    if not env.exists():
        contents = (root / ".env.example").read_text()
        contents = contents.replace("replace-with-a-long-random-password", secrets.token_urlsafe(32))
        contents = contents.replace("replace-with-a-separate-long-random-password", secrets.token_urlsafe(32))
        env.write_text(contents)
        env.chmod(0o600)
    config = root / "config"
    config.mkdir(exist_ok=True)
    for kind in ["profile", "policies"]:
        target = config / f"{kind}.json"
        if not target.exists():
            shutil.copyfile(config / f"{kind}.example.json", target)
            target.chmod(0o644)
    # Container uid 10001 can read the bind mount; host parent protects personal files.
    root.chmod(0o700)
    config.chmod(0o755)


if __name__ == "__main__":
    configure(Path(__file__).resolve().parent.parent)
    print(
        "Configuration prepared; existing files preserved. Add your API keys, verified profile, resume and site permissions before submitting."
    )
