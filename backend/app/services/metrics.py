from collections import defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.config import settings
from app.integrations.langsmith_source import ObservedRun
from app.schemas import AgentMetric, Dashboard, Period, Point, Projection, Roi, TransitionMetric


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def aggregate(
    runs: list[ObservedRun], *, start: datetime, end: datetime,
    truncated: bool, requests_per_user_week: float,
    minutes_saved_per_resolution: float, hourly_cost_usd: float,
    other_operational_cost_usd: float,
) -> Dashboard:
    count = len(runs)
    errors = sum(run.error for run in runs)
    latencies = [run.latency_ms for run in runs if run.latency_ms is not None]
    costs = [run.cost_usd for run in runs if run.cost_usd is not None]
    evaluated = [run for run in runs if run.resolved is not None]
    resolved = sum(run.resolved == 1 for run in evaluated)
    full_cost = count > 0 and len(costs) == count
    total_cost = sum(costs) if costs else None
    average_cost = total_cost / len(costs) if total_cost is not None else None
    resolution_rate = resolved / len(evaluated) if evaluated else None
    cost_per_resolution = total_cost / resolved if total_cost is not None and resolved else None

    warnings = []
    if truncated:
        warnings.append("O período excedeu o limite de traces consultados; os indicadores representam apenas a amostra exibida.")
    if count and not full_cost:
        if costs:
            coverage = len(costs) / count * 100
            warnings.append(
                f"Há traces sem custo informado pelo LangSmith; os valores de custo são parciais "
                f"e usam {len(costs)} de {count} traces ({coverage:.1f}% de cobertura)."
            )
        else:
            warnings.append("Nenhum trace do período possui custo informado pelo LangSmith.")
    if count and len(evaluated) < count:
        warnings.append("Nem todos os traces possuem feedback resolved; a taxa de resolução usa somente os avaliados.")
    if count and not latencies:
        warnings.append("Nenhum trace do período contém duração completa.")
    if count:
        warnings.append("O Astro não registra identificador de usuário no trace; usuários únicos não são mensuráveis neste painel.")
    if count and not any(run.agent_costs_usd for run in runs):
        warnings.append("Os runs filhos não possuem custos que possam ser atribuídos aos agentes neste período.")
    if count and not any(run.agent_latencies_ms for run in runs):
        warnings.append("Duração por agente não está disponível nos traces deste período.")

    agent_values = defaultdict(lambda: {"calls": 0, "total": 0.0, "errors": 0, "cost": 0.0, "has_cost": False})
    transition_values = defaultdict(lambda: {"count": 0, "total": 0.0})
    for run in runs:
        for name, duration in run.agent_latencies_ms.items():
            agent_values[name]["calls"] += 1
            agent_values[name]["total"] += duration
        for name, cost in run.agent_costs_usd.items():
            agent_values[name]["cost"] += cost
            agent_values[name]["has_cost"] = True
        for name, error_count in run.agent_errors.items():
            agent_values[name]["errors"] += error_count
        if not run.agent_errors and run.error_stage and run.error_stage in run.agent_latencies_ms:
            agent_values[run.error_stage]["errors"] += 1
        # The current metadata stores aggregated transition durations, not each transition's count.
        # A name appearing in one root trace is counted once; repeated same-name transitions
        # in a single trace cannot be distinguished without changing Astro instrumentation.
        for name, duration in run.agent_transitions_ms.items():
            transition_values[name]["count"] += 1
            transition_values[name]["total"] += duration

    has_agent_attribution = any(run.agent_costs_usd or run.agent_errors for run in runs)
    agents = [AgentMetric(
        name=name, calls=value["calls"],
        average_latency_ms=value["total"] / value["calls"] if value["calls"] else None,
        total_latency_ms=value["total"],
        attributed_errors=value["errors"] if has_agent_attribution else None,
        cost_usd=value["cost"] if value["has_cost"] else None,
    ) for name, value in sorted(agent_values.items(), key=lambda item: -item[1]["total"])]
    transitions = [TransitionMetric(
        name=name, count=value["count"],
        average_latency_ms=value["total"] / value["count"],
    ) for name, value in sorted(transition_values.items(), key=lambda item: -item[1]["total"])]

    local_timezone = ZoneInfo(settings.analysis_timezone)
    days = defaultdict(list)
    for run in runs:
        days[run.started_at.astimezone(local_timezone).date().isoformat()].append(run)
    daily = []
    day = start.astimezone(local_timezone).date()
    last_day = (end - timedelta(microseconds=1)).astimezone(local_timezone).date()
    while day <= last_day:
        day_runs = days.get(day.isoformat(), [])
        day_latencies = [run.latency_ms for run in day_runs if run.latency_ms is not None]
        day_costs = [run.cost_usd for run in day_runs if run.cost_usd is not None]
        day_errors = sum(run.error for run in day_runs)
        daily.append(Point(
            date=day.isoformat(), executions=len(day_runs), errors=day_errors,
            error_rate=day_errors / len(day_runs) if day_runs else None,
            cost_usd=sum(day_costs) if day_costs else None,
            average_latency_ms=sum(day_latencies) / len(day_latencies) if day_latencies else None,
        ))
        day += timedelta(days=1)

    projections = [Projection(
        weekly_users=users, requests_per_user_week=requests_per_user_week,
        projected_requests=users * requests_per_user_week,
        projected_cost_usd=users * requests_per_user_week * average_cost if average_cost is not None else None,
        projected_resolutions=users * requests_per_user_week * resolution_rate if resolution_rate is not None else None,
    ) for users in (100, 1000)]
    benefit = resolved * minutes_saved_per_resolution / 60 * hourly_cost_usd if evaluated else None
    roi_total_cost = total_cost + other_operational_cost_usd if total_cost is not None else None
    net = benefit - roi_total_cost if benefit is not None and roi_total_cost is not None else None
    roi = Roi(
        minutes_saved_per_resolution=minutes_saved_per_resolution,
        hourly_cost_usd=hourly_cost_usd,
        other_operational_cost_usd=other_operational_cost_usd,
        benefit_usd=benefit, total_cost_usd=roi_total_cost,
        net_benefit_usd=net,
        roi_percent=net / roi_total_cost * 100 if net is not None and roi_total_cost and roi_total_cost > 0 else None,
    )
    return Dashboard(
        period=Period(start=start, end=end), generated_at=datetime.now(timezone.utc),
        data_status="empty" if not count else "partial" if warnings or truncated else "complete",
        warnings=warnings, runs_examined=count, executions=count, successes=count - errors,
        errors=errors, success_rate=(count - errors) / count if count else None,
        error_rate=errors / count if count else None,
        average_latency_ms=sum(latencies) / len(latencies) if latencies else None,
        p50_latency_ms=percentile(latencies, .5), p95_latency_ms=percentile(latencies, .95),
        p99_latency_ms=percentile(latencies, .99),
        min_latency_ms=min(latencies) if latencies else None,
        max_latency_ms=max(latencies) if latencies else None,
        cost_coverage=len(costs) / count if count else None,
        total_cost_usd=total_cost, average_cost_usd=average_cost,
        resolution_evaluated_count=len(evaluated), resolved_count=resolved,
        resolution_coverage=len(evaluated) / count if count else None,
        resolution_rate=resolution_rate, cost_per_resolution_usd=cost_per_resolution,
        agents=agents, transitions=transitions, daily=daily, projections=projections, roi=roi,
    )
