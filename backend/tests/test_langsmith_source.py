from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.integrations.langsmith_source import LangSmithSource


def test_reads_astro_root_metadata_and_existing_resolved_feedback():
    start = datetime(2026, 9, 20, tzinfo=timezone.utc)
    root = SimpleNamespace(
        id="trace-1", trace_id="trace-1", start_time=start + timedelta(hours=1), end_time=start + timedelta(hours=1, seconds=2),
        total_cost=.25, error=None,
        extra={"metadata": {
            "total_response_ms": 1900,
            "agent_latencies_ms": '{"roteador":200,"sst":700}',
            "agent_transitions_ms": '{"roteador->sst":50}',
            "agent_call_count": 2,
            "agent_transition_count": 1,
        }},
    )

    class FakeClient:
        def list_runs(self, **kwargs):
            if kwargs["is_root"] is True:
                assert kwargs["filter"] == 'eq(name, "astro_chat")'
                assert "extra" in kwargs["select"]
                assert "limit" not in kwargs  # LangSmith caps each request at 100; its SDK paginates.
                yield root
                return
            assert kwargs["trace_filter"] == 'eq(name, "astro_chat")'
            assert kwargs["run_type"] == "chain"
            yield SimpleNamespace(
                id="agent-1", trace_id="trace-1", parent_run_id="trace-1",
                name="roteador", run_type="chain", total_cost=.10, error=None,
            )
            yield SimpleNamespace(
                id="agent-1-inner", trace_id="trace-1", parent_run_id="agent-1",
                name="roteador", run_type="chain", total_cost=.10, error=None,
            )
            yield SimpleNamespace(
                id="agent-2", trace_id="trace-1", parent_run_id="trace-1",
                name="sst", run_type="chain", total_cost=.15, error="failure",
            )

        def list_feedback(self, **kwargs):
            assert kwargs["feedback_key"] == ["resolved"]
            yield SimpleNamespace(run_id="trace-1", score=1)

    result, truncated = LangSmithSource(FakeClient()).load(start, start + timedelta(days=1))
    assert not truncated
    assert len(result) == 1
    assert result[0].resolved == 1
    assert result[0].latency_ms == 1900
    assert result[0].agent_latencies_ms == {"roteador": 200, "sst": 700}
    assert result[0].agent_transitions_ms == {"roteador->sst": 50}
    assert result[0].agent_costs_usd == {"roteador": .10, "sst": .15}
    assert result[0].agent_errors == {"sst": 1}
