from datetime import datetime

from pydantic import BaseModel, Field


class Period(BaseModel):
    start: datetime
    end: datetime


class Point(BaseModel):
    date: str
    executions: int
    errors: int
    error_rate: float | None
    cost_usd: float | None
    average_latency_ms: float | None


class AgentMetric(BaseModel):
    name: str
    calls: int
    average_latency_ms: float | None
    total_latency_ms: float
    attributed_errors: int | None = None
    cost_usd: float | None = None


class TransitionMetric(BaseModel):
    name: str
    count: int
    average_latency_ms: float | None


class Projection(BaseModel):
    weekly_users: int
    requests_per_user_week: float
    projected_requests: float
    projected_cost_usd: float | None
    projected_resolutions: float | None


class Roi(BaseModel):
    estimated: bool = True
    minutes_saved_per_resolution: float
    hourly_cost_usd: float
    other_operational_cost_usd: float
    benefit_usd: float | None
    total_cost_usd: float | None
    net_benefit_usd: float | None
    roi_percent: float | None


class Dashboard(BaseModel):
    period: Period
    generated_at: datetime
    data_status: str
    warnings: list[str] = Field(default_factory=list)
    runs_examined: int
    users_analyzed: int | None = None
    executions: int
    successes: int
    errors: int
    success_rate: float | None
    error_rate: float | None
    average_latency_ms: float | None
    p50_latency_ms: float | None
    p95_latency_ms: float | None
    p99_latency_ms: float | None
    min_latency_ms: float | None
    max_latency_ms: float | None
    cost_coverage: float | None
    total_cost_usd: float | None
    average_cost_usd: float | None
    resolution_evaluated_count: int
    resolved_count: int
    resolution_coverage: float | None
    resolution_rate: float | None
    cost_per_resolution_usd: float | None
    agents: list[AgentMetric]
    transitions: list[TransitionMetric]
    daily: list[Point]
    projections: list[Projection]
    roi: Roi
