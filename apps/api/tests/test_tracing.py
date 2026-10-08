"""Agent tracing: one span per unit of AI work, token counts on it, no prompt text, nothing when tracing is off."""

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from nox_api.ai import telemetry, tracing


@pytest.fixture
def spans(monkeypatch):
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    monkeypatch.setattr(tracing, "tracer", lambda: provider.get_tracer("nox"))
    yield exporter
    provider.shutdown()


def test_a_usage_scope_is_one_span_with_its_token_counts(spans):
    with telemetry.tags(org_id="org-1"), telemetry.usage_scope("mission:draft", mission_id="m-1") as u:
        u.add_response(type("Meta", (), {"prompt_token_count": 120, "candidates_token_count": 30,
                                         "cached_content_token_count": 100, "thoughts_token_count": 0})(), "gemini-x")
        u.tool_calls += 2
    (span,) = spans.get_finished_spans()
    assert span.name == "nox.mission:draft"
    a = span.attributes
    assert a["nox.org_id"] == "org-1" and a["nox.mission_id"] == "m-1"
    assert (a["nox.calls"], a["nox.tool_calls"]) == (1, 2)
    assert (a["nox.tokens.input"], a["nox.tokens.cached"], a["nox.tokens.output"]) == (120, 100, 30)
    assert not any("prompt" in k or "content" in k for k in a)  # numbers and ids only
    assert u.tags["trace_id"] == format(span.context.trace_id, "032x")


def test_nested_scopes_share_one_trace(spans):
    with telemetry.usage_scope("kb:build"):
        with telemetry.usage_scope("kb:page"):
            pass
    inner, outer = spans.get_finished_spans()
    assert inner.parent.span_id == outer.context.span_id
    assert inner.context.trace_id == outer.context.trace_id


def test_tracing_off_installs_nothing(monkeypatch):
    monkeypatch.setattr(tracing, "_done", False)
    monkeypatch.setattr(tracing.settings, "NOX_TRACE", "off")
    called = []
    monkeypatch.setattr("google.adk.telemetry.setup.maybe_set_otel_providers", lambda *a, **k: called.append(1))
    assert tracing.setup("nox-api") is False
    assert called == []
    with telemetry.usage_scope("ask") as u:  # still works, with a no-op span
        pass
    assert "trace_id" not in u.tags


def test_content_capture_is_off_by_default():
    import os

    assert os.environ["OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"] in ("NO_CONTENT", "")
    assert os.environ["ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS"].lower() == "false"
