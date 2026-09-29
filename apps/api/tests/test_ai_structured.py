"""ADK foundation: typed outputs, backend selection, usage accounting, and the migrated one-shot agents."""

import pytest
from pydantic import ValidationError

from nox_api.ai import config, structured, telemetry
from nox_api.ai.schemas import GatekeeperDecision, RollupResult

from .ai_fakes import FakeLlm, data, request_text, text, use_fake


async def test_structured_ask_returns_validated_model(monkeypatch):
    fake = use_fake(monkeypatch, FakeLlm(script=[data({"decision": "trivial", "reason": "typo", "affected_files": []})]))
    out = await structured.ask(GatekeeperDecision, "fix typo in README", name="t", instruction="classify")
    assert out == GatekeeperDecision(decision="trivial", reason="typo", affected_files=[])
    assert "fix typo in README" in request_text(fake.requests[0])


async def test_structured_ask_accepts_fenced_json_from_local_models(monkeypatch):
    use_fake(monkeypatch, FakeLlm(script=[text('Sure!\n```json\n{"decision": "significant", "reason": "new API"}\n```')]))
    out = await structured.ask(GatekeeperDecision, "diff", name="t", local=True)
    assert out.decision == "significant"


async def test_structured_ask_rejects_output_outside_the_schema(monkeypatch):
    use_fake(monkeypatch, FakeLlm(script=[data({"decision": "maybe", "reason": "?"})]))
    with pytest.raises(ValidationError):
        await structured.ask(GatekeeperDecision, "diff", name="t")


async def test_usage_scope_counts_calls_tokens_and_cache(monkeypatch):
    use_fake(monkeypatch, FakeLlm(script=[
        text('{"decision": "trivial", "reason": "a"}', prompt_tokens=1000, cached=600, output_tokens=10),
        text('{"decision": "trivial", "reason": "b"}', prompt_tokens=500, cached=0, output_tokens=10),
    ]))
    with telemetry.usage_scope("kb-build") as outer:
        await structured.ask(GatekeeperDecision, "one", name="t")
        with telemetry.usage_scope("inner") as inner:
            await structured.ask(GatekeeperDecision, "two", name="t")
    assert inner.calls == 1 and inner.input_tokens == 500
    assert outer.calls == 2 and outer.input_tokens == 1500 and outer.cached_tokens == 600
    assert outer.cached_share == pytest.approx(0.4)
    assert "2 calls" in outer.line() and "40% cached" in outer.line()


async def test_gatekeeper_uses_typed_agent_and_keeps_error_fallback(monkeypatch):
    from nox_api.agents import gatekeeper

    use_fake(monkeypatch, FakeLlm(script=[data({"decision": "significant", "reason": "new gRPC API", "affected_files": ["summaries/api-spec.md"]})]))
    out = await gatekeeper.run_gatekeeper("+ service Payments { rpc Settle() }")
    assert out == {"decision": "significant", "reason": "new gRPC API", "affected_files": ["summaries/api-spec.md"], "fast_path": False}

    use_fake(monkeypatch, FakeLlm(script=[]))  # model failure → conservative default
    out = await gatekeeper.run_gatekeeper("diff")
    assert out["decision"] == "significant" and out["fast_path"] is False


async def test_rollup_maps_files_to_paths(monkeypatch):
    from nox_api.agents.rollup import run_rollup

    use_fake(monkeypatch, FakeLlm(script=[data(RollupResult(files=[{"path": "index.md", "markdown": "# Org"}]).model_dump())]))
    assert await run_rollup("org-1", [{"app_name": "orders", "index": "# Orders"}]) == {"index.md": "# Org"}


def test_backend_selection(monkeypatch):
    s = config.settings
    monkeypatch.setattr(s, "NOX_AI_BACKEND", "")
    monkeypatch.setattr(s, "GOOGLE_CLOUD_PROJECT", "")
    monkeypatch.setattr(s, "GCP_PROJECT_ID", "")
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)
    assert config.backend() == "api_key"
    monkeypatch.setattr(s, "GCP_PROJECT_ID", "proj")
    assert config.backend() == "enterprise"
    assert config._client_kwargs() == {"enterprise": True, "project": "proj", "location": s.GOOGLE_CLOUD_LOCATION}
    monkeypatch.setattr(s, "NOX_AI_BACKEND", "local")
    assert config.backend() == "local"


def test_tiers_fall_back_to_the_default_model(monkeypatch):
    s = config.settings
    monkeypatch.setattr(s, "GEMINI_MODEL", "m-default")
    monkeypatch.setattr(s, "NOX_MODEL_FAST", "")
    monkeypatch.setattr(s, "NOX_MODEL_DEEP", "m-deep")
    assert config.model_name(config.Tier.FAST) == "m-default"
    assert config.model_name(config.Tier.DEEP) == "m-deep"
