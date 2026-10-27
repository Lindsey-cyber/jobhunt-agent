import os
import tempfile
from pathlib import Path

TEST_DIR = Path(tempfile.mkdtemp(prefix="jobhunt-tests-"))
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DIR}/test.db"
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
