import logging
import time
from datetime import datetime, timedelta, timezone
from threading import Lock
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.integrations.langsmith_source import LangSmithSource
from app.schemas import Dashboard
from app.services.metrics import aggregate

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger("astro_observabilidade")
app = FastAPI(title="Astro Observabilidade", version="1.0.0")
app.add_middleware(
    CORSMiddleware, allow_origins=list(settings.allowed_origins),
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["GET"],
)
_cache: dict[tuple, tuple[float, Dashboard]] = {}
_cache_lock = Lock()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/observability/dashboard", response_model=Dashboard)
def dashboard(
    period: str = Query(default="7d", pattern="^(today|24h|7d|30d|custom)$"),
    start: datetime | None = None,
    end: datetime | None = None,
    requests_per_user_week: float = Query(default=5, gt=0, le=1000),
    minutes_saved_per_resolution: float = Query(default=9.5, ge=0, le=1440),
    hourly_cost_usd: float = Query(default=6, ge=0, le=10000),
    other_operational_cost_usd: float = Query(default=0, ge=0, le=10000000),
) -> Dashboard:
    if not settings.langsmith_api_key:
        raise HTTPException(503, "LANGSMITH_API_KEY não configurada no backend.")
    now = datetime.now(timezone.utc)
    if period == "custom":
        if not start or not end or start.tzinfo is None or end.tzinfo is None:
            raise HTTPException(422, "Informe start e end com fuso horário para período personalizado.")
        period_start, period_end = start.astimezone(timezone.utc), end.astimezone(timezone.utc)
    else:
        period_end = now
        period_start = {
            "today": now.astimezone(ZoneInfo(settings.analysis_timezone)).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc),
            "24h": now - timedelta(hours=24),
            "7d": now - timedelta(days=7),
            "30d": now - timedelta(days=30),
        }[period]
    if period_start >= period_end or period_end > now + timedelta(minutes=1) or period_end - period_start > timedelta(days=90):
        raise HTTPException(422, "O intervalo deve ser válido e ter no máximo 90 dias.")
    key = (period_start.isoformat()[:16], period_end.isoformat()[:16], requests_per_user_week,
           minutes_saved_per_resolution, hourly_cost_usd, other_operational_cost_usd)
    with _cache_lock:
        cached = _cache.get(key)
        if cached and cached[0] > time.monotonic():
            return cached[1]
    try:
        runs, truncated = LangSmithSource().load(period_start, period_end)
        result = aggregate(
            runs, start=period_start, end=period_end, truncated=truncated,
            requests_per_user_week=requests_per_user_week,
            minutes_saved_per_resolution=minutes_saved_per_resolution,
            hourly_cost_usd=hourly_cost_usd,
            other_operational_cost_usd=other_operational_cost_usd,
        )
    except Exception as error:
        logger.exception('event=langsmith_query_failed error_type=%s', type(error).__name__)
        raise HTTPException(502, "Não foi possível consultar o LangSmith agora.") from None
    with _cache_lock:
        if len(_cache) > 100:
            _cache.clear()
        _cache[key] = (time.monotonic() + settings.cache_ttl_seconds, result)
    logger.info('event=dashboard_loaded runs=%s status=%s', len(runs), result.data_status)
    return result
