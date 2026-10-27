import os
import tempfile
from pathlib import Path

TEST_DIR = Path(tempfile.mkdtemp(prefix="jobhunt-tests-"))
postgres_test = os.environ.get("TEST_POSTGRES_URL", "")
if postgres_test and not postgres_test.rsplit("/", 1)[-1].startswith("jobhunt_test"):
    raise RuntimeError("TEST_POSTGRES_URL must point to a disposable jobhunt_test database")
os.environ["DATABASE_URL"] = postgres_test or f"sqlite:///{TEST_DIR}/test.db"
os.environ["DATA_DIR"] = str(TEST_DIR)
os.environ["WORKER_ENABLED"] = "false"
os.environ["DASHBOARD_TOKEN"] = "test-secret"

import pytest

from jobhunt.db import Base, engine


@pytest.fixture(autouse=True)
def clean_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
