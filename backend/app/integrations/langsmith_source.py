"""Read-only adapter for the Astro `astro_chat` root runs and `resolved` feedback."""

import json
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from langsmith import Client

from app.config import settings


@dataclass(frozen=True)
class ObservedRun:
    run_id: str
    started_at: datetime
    latency_ms: float | None
    cost_usd: float | None
    error: bool
    resolved: int | None
    agent_latencies_ms: dict[str, float]
    agent_transitions_ms: dict[str, float]
    agent_call_count: int
    agent_transition_count: int
    error_stage: str | None
    agent_costs_usd: dict[str, float] = field(default_factory=dict)
    agent_errors: dict[str, int] = field(default_factory=dict)


def _number_map(raw: Any) -> dict[str, float]:
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
        if not isinstance(data, dict):
            return {}
        return {str(key): float(value) for key, value in data.items() if isinstance(value, (int, float)) and float(value) >= 0}
    except (ValueError, TypeError):
        return {}


def _nonnegative_number(raw: Any) -> float | None:
    try:
        value = float(raw)
        return value if value >= 0 else None
    except (ValueError, TypeError):
        return None


class LangSmithSource:
    def __init__(self, client: Client | None = None):
        self.client = client or Client(
            api_url=settings.langsmith_endpoint,
            api_key=settings.langsmith_api_key,
            workspace_id=settings.langsmith_workspace_id,
        )

    def load(self, start: datetime, end: datetime) -> tuple[list[ObservedRun], bool]:
        selected = ["id", "start_time", "end_time", "error", "total_cost", "extra"]
        candidates = self.client.list_runs(
            project_name=settings.langsmith_project,
            is_root=True,
            filter='eq(name, "astro_chat")',
            start_time=start,
            select=selected,
        )
        runs = []
        truncated = False
        for run in candidates:
            if run.start_time is None or run.start_time >= end:
                continue
            if len(runs) >= settings.max_root_runs:
                truncated = True
                break
            runs.append(run)

        feedback: dict[str, int] = {}
        ids = [run.id for run in runs]
        for offset in range(0, len(ids), 100):
            for item in self.client.list_feedback(run_ids=ids[offset:offset + 100], feedback_key=["resolved"]):
                if item.run_id is not None and item.score is not None:
                    feedback[str(item.run_id)] = int(float(item.score) >= 0.5)

        trace_ids = {str(getattr(run, "trace_id", None) or run.id) for run in runs}
        root_metadata = {
            str(run.id): ((run.extra or {}).get("metadata") or {})
            if isinstance(run.extra, dict) else {}
            for run in runs
        }
        agent_names = {
            name
            for metadata in root_metadata.values()
            for name in _number_map(metadata.get("agent_latencies_ms"))
        }
        agent_costs_by_trace: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
        agent_errors_by_trace: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        if trace_ids and agent_names:
            child_runs = [child for child in self.client.list_runs(
                project_name=settings.langsmith_project,
                is_root=False,
                run_type="chain",
                start_time=start,
                trace_filter='eq(name, "astro_chat")',
                select=["id", "trace_id", "parent_run_id", "name", "run_type", "total_cost", "error"],
            ) if str(child.trace_id) in trace_ids]
            children_by_id = {str(child.id): child for child in child_runs}
            for child in child_runs:
                name = str(child.name)
                if name not in agent_names:
                    continue
                ancestor_id = child.parent_run_id
                nested_same_name = False
                while ancestor_id is not None and str(ancestor_id) in children_by_id:
                    ancestor = children_by_id[str(ancestor_id)]
                    if str(ancestor.name) == name:
                        nested_same_name = True
                        break
                    ancestor_id = ancestor.parent_run_id
                if nested_same_name:
                    continue
                trace_id = str(child.trace_id)
                cost = _nonnegative_number(child.total_cost)
                if cost is not None:
                    agent_costs_by_trace[trace_id][name] += cost
                if child.error:
                    agent_errors_by_trace[trace_id][name] += 1

        observed = []
        for run in runs:
            metadata = root_metadata[str(run.id)]
            trace_id = str(getattr(run, "trace_id", None) or run.id)
            latency = _nonnegative_number(metadata.get("total_response_ms"))
            if latency is None and run.end_time is not None:
                latency = max(0.0, (run.end_time - run.start_time).total_seconds() * 1000)
            observed.append(ObservedRun(
                run_id=str(run.id),
                started_at=run.start_time,
                latency_ms=latency,
                cost_usd=_nonnegative_number(run.total_cost),
                error=bool(run.error) or bool(metadata.get("error_type")),
                resolved=feedback.get(str(run.id)),
                agent_latencies_ms=_number_map(metadata.get("agent_latencies_ms")),
                agent_transitions_ms=_number_map(metadata.get("agent_transitions_ms")),
                agent_call_count=int(metadata.get("agent_call_count") or 0),
                agent_transition_count=int(metadata.get("agent_transition_count") or 0),
                error_stage=str(metadata.get("error_stage")) if metadata.get("error_stage") else None,
                agent_costs_usd=dict(agent_costs_by_trace.get(trace_id, {})),
                agent_errors=dict(agent_errors_by_trace.get(trace_id, {})),
            ))
        return observed, truncated
