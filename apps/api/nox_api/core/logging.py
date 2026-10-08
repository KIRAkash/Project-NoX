"""Logging with a per-request id, so one request's lines can be followed across modules.

On Cloud Run each line is JSON that Cloud Logging understands (severity, message, and the trace it belongs to
when tracing is on), so a trace in Cloud Trace shows its own log lines. Locally it stays one readable line.
"""

import contextvars
import json
import logging
import os
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")


class _RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


class _CloudFormatter(logging.Formatter):
    """One JSON object per line, in the shape Cloud Logging reads from Cloud Run's stdout."""

    def format(self, record: logging.LogRecord) -> str:
        entry = {"severity": record.levelname, "message": record.getMessage(), "logger": record.name,
                 "request_id": getattr(record, "request_id", "-")}
        if record.exc_info:
            entry["message"] += "\n" + self.formatException(record.exc_info)
        try:
            from ..ai.tracing import log_trace_field

            if trace := log_trace_field():
                entry["logging.googleapis.com/trace"] = trace
        except Exception:
            pass
        return json.dumps(entry, default=str)


def configure_logging(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler()
    handler.addFilter(_RequestIdFilter())
    if os.getenv("K_SERVICE"):  # Cloud Run
        handler.setFormatter(_CloudFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] [%(request_id)s] %(name)s: %(message)s"))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Reads X-Request-ID (or mints one), exposes it to log records, and echoes it on the response."""

    async def dispatch(self, request: Request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        token = request_id_var.set(rid)
        try:
            response = await call_next(request)
        finally:
            request_id_var.reset(token)
        response.headers["X-Request-ID"] = rid
        return response
