import json
import logging
import re
import time
import uuid
from contextvars import ContextVar
from pathlib import PurePath
from traceback import extract_tb

request_context = ContextVar("observability_request", default=None)


def diagnostic(error):
    result = {"error_type": type(error).__name__, "error_code": "UNCLASSIFIED_ERROR"}
    causes = []
    frames = []
    seen = set()
    current = error
    while isinstance(current, BaseException) and id(current) not in seen and len(seen) < 5:
        seen.add(id(current))
        code = getattr(current, "sqlstate", None) or getattr(current, "pgcode", None) or getattr(current, "errno", None)
        if code is not None and re.fullmatch(r"[A-Z0-9_]{1,32}", str(code)):
            result["error_code"] = str(code)
        causes.append(type(current).__name__)
        for frame in extract_tb(current.__traceback__, limit=12):
            filename = PurePath(frame.filename).name
            if re.fullmatch(r"[A-Za-z0-9_.-]+", filename):
                frames.append(f"{filename}:{frame.lineno}:{frame.name}")
        current = current.__cause__ or (None if current.__suppress_context__ else current.__context__)
    result["error_causes"] = " > ".join(causes)
    result["error_frames"] = " > ".join(frames[-16:])
    return result


def emit(event, *, level="INFO", sink=None, **fields):
    payload = {"event": event, "severity": level, **(request_context.get() or {}), **fields}
    if sink is None:
        print(json.dumps(payload, ensure_ascii=False), flush=True)
    else:
        sink.log(getattr(logging, level), event, extra=payload)


class HttpObservability:
    def __init__(self, app, service, sink=None, terminal=True):
        self.app, self.service, self.sink, self.terminal = app, service, sink, terminal

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)
        observation = {"service_name": self.service, "request_id": str(uuid.uuid4())}
        scope["astro_observation"] = observation
        token = request_context.set(observation)
        start = time.perf_counter()
        status = 500

        async def capture(message):
            nonlocal status
            if message.get("type") == "http.response.start":
                status = message["status"]
                message = dict(message)
                message["headers"] = [(key, value) for key, value in message.get("headers", []) if key.lower() != b"x-request-id"]
                message["headers"].append((b"x-request-id", observation["request_id"].encode()))
            await send(message)

        try:
            await self.app(scope, receive, capture)
        except Exception as error:
            emit("request_failed", level="ERROR", sink=self.sink, **diagnostic(error))
            raise
        finally:
            observation.update(http_method=scope.get("method", "OTHER"),
                               http_route=getattr(scope.get("route"), "path", "unmatched"),
                               http_status=status, duration_ms=round((time.perf_counter() - start) * 1000, 2))
            try:
                if self.terminal:
                    emit("http_request_finished", level="ERROR" if status >= 500 else "WARNING" if status >= 400 else "INFO", sink=self.sink)
            finally:
                request_context.reset(token)
