from dataclasses import replace
from datetime import timezone

from fastapi.testclient import TestClient

from app import main
from app.services import metrics


def test_dashboard_is_available_without_access_token(monkeypatch):
    monkeypatch.setattr(main, "settings", replace(main.settings, langsmith_api_key="test-key"))
    monkeypatch.setattr(main.LangSmithSource, "load", lambda self, start, end: ([], False))
    monkeypatch.setattr(main, "ZoneInfo", lambda name: timezone.utc)
    monkeypatch.setattr(metrics, "ZoneInfo", lambda name: timezone.utc)

    response = TestClient(main.app).get(
        "/api/observability/dashboard?period=7d",
        headers={"Origin": "http://localhost:4174"},
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:4174"
    assert response.json()["data_status"] == "empty"
