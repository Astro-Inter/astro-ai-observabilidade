import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    langsmith_api_key: str = os.getenv("LANGSMITH_API_KEY", "")
    langsmith_project: str = os.getenv("LANGSMITH_PROJECT", "astro-ai-api")
    langsmith_endpoint: str = os.getenv("LANGSMITH_ENDPOINT", "https://api.smith.langchain.com")
    langsmith_workspace_id: str | None = os.getenv("LANGSMITH_WORKSPACE_ID") or None
    allowed_origins: tuple[str, ...] = tuple(
        origin.strip().rstrip("/") for origin in os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173").split(",") if origin.strip()
    )
    cache_ttl_seconds: int = max(30, int(os.getenv("CACHE_TTL_SECONDS", "300")))
    max_root_runs: int = max(100, int(os.getenv("MAX_ROOT_RUNS", "5000")))
    analysis_timezone: str = os.getenv("ANALYSIS_TIMEZONE", "America/Sao_Paulo")


settings = Settings()
