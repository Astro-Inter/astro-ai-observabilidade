from datetime import datetime, timezone

import pytest

from app.integrations.langsmith_source import ObservedRun, _number_map
from app.services.metrics import aggregate, percentile


START = datetime(2026, 9, 15, tzinfo=timezone.utc)
END = datetime(2026, 9, 17, tzinfo=timezone.utc)


def run(name, *, latency, cost, error, resolved, agent_costs=None, agent_errors=None):
    return ObservedRun(
        run_id=name, started_at=START, latency_ms=latency, cost_usd=cost,
        error=error, resolved=resolved,
        agent_latencies_ms={"roteador": 100, "sst": 300},
        agent_transitions_ms={"roteador->sst": 20},
        agent_call_count=2, agent_transition_count=1,
        error_stage="sst" if error else None,
        agent_costs_usd=agent_costs or {}, agent_errors=agent_errors or {},
    )


def summarize(items):
    return aggregate(items, start=START, end=END, truncated=False,
                     requests_per_user_week=5, minutes_saved_per_resolution=10,
                     hourly_cost_usd=6, other_operational_cost_usd=0)


def test_observed_metrics_projection_and_roi():
    result = summarize([
        run("1", latency=100, cost=.20, error=False, resolved=1, agent_costs={"roteador": .05, "sst": .15}),
        run("2", latency=300, cost=.10, error=True, resolved=0, agent_costs={"roteador": .04, "sst": .06}, agent_errors={"sst": 1}),
    ])
    assert result.executions == 2
    assert result.error_rate == .5
    assert result.p50_latency_ms == 200
    assert result.p95_latency_ms == 290
    assert result.total_cost_usd == pytest.approx(.30)
    assert result.cost_per_resolution_usd == pytest.approx(.30)
    assert result.projections[0].weekly_users == 100
    assert result.projections[0].projected_cost_usd == pytest.approx(75)
    assert result.roi.benefit_usd == 1
    assert result.roi.roi_percent is not None
    assert result.users_analyzed is None
    agents = {agent.name: agent for agent in result.agents}
    assert agents["roteador"].cost_usd == pytest.approx(.09)
    assert agents["roteador"].attributed_errors == 0
    assert agents["sst"].cost_usd == pytest.approx(.21)
    assert agents["sst"].attributed_errors == 1


def test_missing_cost_is_unavailable_not_zero():
    result = summarize([run("1", latency=100, cost=None, error=False, resolved=1)])
    assert result.total_cost_usd is None
    assert result.cost_per_resolution_usd is None
    assert result.roi.roi_percent is None
    assert result.projections[0].projected_cost_usd is None


def test_partial_cost_uses_available_traces_and_reports_coverage():
    result = summarize([
        run("1", latency=100, cost=.20, error=False, resolved=1),
        run("2", latency=200, cost=None, error=True, resolved=0),
    ])
    assert result.total_cost_usd == pytest.approx(.20)
    assert result.average_cost_usd == pytest.approx(.20)
    assert result.cost_per_resolution_usd == pytest.approx(.20)
    assert result.cost_coverage == pytest.approx(.5)
    assert result.daily[0].cost_usd == pytest.approx(.20)
    assert result.projections[0].projected_cost_usd == pytest.approx(100)
    assert result.roi.total_cost_usd == pytest.approx(.20)
    assert any("valores de custo são parciais" in warning for warning in result.warnings)


def test_missing_feedback_is_unavailable_not_success():
    result = summarize([run("1", latency=100, cost=.1, error=False, resolved=None)])
    assert result.resolution_rate is None
    assert result.cost_per_resolution_usd is None
    assert result.roi.benefit_usd is None


def test_empty_period_uses_nullable_indicators():
    result = summarize([])
    assert result.data_status == "empty"
    assert result.error_rate is None
    assert result.total_cost_usd is None
    assert result.average_latency_ms is None


def test_metadata_reader_accepts_current_json_format_only():
    assert _number_map('{"roteador":200,"sst":500}') == {"roteador": 200, "sst": 500}
    assert _number_map('[]') == {}
    assert percentile([], .95) is None
