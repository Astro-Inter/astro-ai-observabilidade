import asyncio
import json
from types import SimpleNamespace

from app.diagnostics import HttpObservability, diagnostic, request_context


def test_diagnostic_never_copies_driver_message_or_locals():
    try:
        error = RuntimeError("password=private email=private@example.com SQL private")
        error.sqlstate = "53300"
        raise error
    except RuntimeError as failure:
        result = diagnostic(failure)
    assert result["error_code"] == "53300"
    assert ".py:" in result["error_frames"]
    assert "private" not in json.dumps(result)


def test_concurrent_http_context_and_cleanup(capsys):
    async def app(scope, receive, send):
        before = request_context.get()["request_id"]
        await asyncio.sleep(0)
        assert request_context.get()["request_id"] == before
        scope["route"] = SimpleNamespace(path="/items/{id}")
        await send({"type": "http.response.start", "status": 503, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    async def run():
        middleware = HttpObservability(app, "test-service")
        async def send(message):
            pass
        scopes = [{"type": "http", "method": "GET", "path": "/private", "query_string": b"secret=private"} for _ in range(2)]
        await asyncio.gather(*(middleware(scope, None, send) for scope in scopes))
        assert scopes[0]["astro_observation"]["request_id"] != scopes[1]["astro_observation"]["request_id"]
        assert request_context.get() is None
    asyncio.run(run())
    output = capsys.readouterr().out
    assert "private" not in output
    assert '"http_route": "/items/{id}"' in output
