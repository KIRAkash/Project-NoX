"""Agent tracing: every unit of AI work as one trace in Cloud Trace.

ADK already emits OpenTelemetry spans for each agent, tool call and model call. NoX adds one span per
`telemetry.usage_scope()` (a KB build, a mission draft, an Ask turn, a lesson), so a whole unit of work reads as
one trace with ADK's spans nested inside it, and its token counts on the root.

    NOX_TRACE=cloud     spans go to Cloud Trace through ADK's exporter for the Telemetry (OTLP) API
    NOX_TRACE=console   spans are printed (local debugging)
    NOX_TRACE=off       no provider is installed; spans are no-ops

`setup()` must run before any ADK Runner is created (the API's lifespan, the worker's process init). Prompt and
response text never goes into a span: specs and KB pages stay out of traces.
"""

from __future__ import annotations

import logging
import os

from ..core.config import settings

logger = logging.getLogger(__name__)

# No message content in spans, whatever ADK's defaults are. Set on import, before ADK reads its telemetry config.
os.environ.setdefault("OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT", "NO_CONTENT")
os.environ.setdefault("ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS", "false")

_done = False


def mode() -> str:
    return (settings.NOX_TRACE or "off").strip().lower()


def setup(service_name: str) -> bool:
    """Install the tracer provider once per process. Returns whether tracing is on."""
    global _done
    if _done:
        return mode() != "off"
    _done = True
    if mode() == "off":
        return False
    os.environ.setdefault("OTEL_SERVICE_NAME", service_name)
    try:
        from google.adk.telemetry.setup import OTelHooks, maybe_set_otel_providers
        from opentelemetry.sdk.resources import Resource

        resource = Resource.create({"service.name": service_name, "service.namespace": "nox"})
        if mode() == "console":
            from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor

            hooks = OTelHooks(span_processors=[SimpleSpanProcessor(ConsoleSpanExporter())])
        else:
            import google.auth
            from google.adk.telemetry.google_cloud import get_gcp_exporters

            from .config import project

            credentials, default_project = google.auth.default()
            hooks = get_gcp_exporters(enable_cloud_tracing=True, google_auth=(credentials, project() or default_project))
        maybe_set_otel_providers([hooks], otel_resource=resource)
        logger.info(f"tracing: {mode()} ({service_name})")
        return True
    except Exception as e:  # tracing never stops NoX from starting
        logger.warning(f"tracing not started: {e}")
        return False


def tracer():
    from opentelemetry import trace

    return trace.get_tracer("nox")


def trace_id() -> str | None:
    """The current trace's id as Cloud Trace shows it, or None outside a recorded span."""
    from opentelemetry import trace

    ctx = trace.get_current_span().get_span_context()
    return format(ctx.trace_id, "032x") if ctx.is_valid else None


def log_trace_field() -> str | None:
    """`projects/<p>/traces/<id>` for Cloud Logging's trace field, so logs show inside their trace."""
    tid = trace_id()
    if not tid or mode() != "cloud":
        return None
    from .config import project

    return f"projects/{project()}/traces/{tid}" if project() else None
