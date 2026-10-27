from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = "sqlite:///data/jobhunt.db"
    openai_api_key: str = ""
    openai_model: str = "gpt-4.1"
    brave_api_key: str = ""
    tavily_api_key: str = ""
    dashboard_token: str = ""
    data_dir: Path = Path("data")
    profile_path: Path = Path("config/profile.json")
    policies_path: Path = Path("config/policies.json")
    resume_path: Path = Path("config/resume.pdf")
    daily_limit: int = 100
    auto_submit: bool = False
    discovery_interval: int = 1800
    search_queries_per_cycle: int = 12
    sources_per_cycle: int = 200
    discovery_concurrency: int = 6
    http_retries: int = 3
    heartbeat_interval: int = 15
    worker_stale_seconds: int = 90
    poll_interval: int = 30
    max_attempts: int = 3
    browser_steps: int = 80
    timezone: str = "America/New_York"
    worker_enabled: bool = True
    allow_local_test_urls: bool = False


settings = Settings()
settings.data_dir.mkdir(parents=True, exist_ok=True)
