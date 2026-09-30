"""A scripted stand-in for Gemini, so ADK agents run in tests without a network."""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator, Callable

from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types


def text(t: str, *, prompt_tokens: int = 100, cached: int = 0, output_tokens: int = 20) -> LlmResponse:
    return LlmResponse(
        content=types.Content(role="model", parts=[types.Part(text=t)]),
        usage_metadata=types.GenerateContentResponseUsageMetadata(
            prompt_token_count=prompt_tokens, cached_content_token_count=cached, candidates_token_count=output_tokens),
        model_version="fake-model",
    )


def data(obj) -> LlmResponse:
    return text(json.dumps(obj))


def call(name: str, **args) -> LlmResponse:
    return LlmResponse(
        content=types.Content(role="model", parts=[types.Part(function_call=types.FunctionCall(name=name, args=args))]),
        usage_metadata=types.GenerateContentResponseUsageMetadata(prompt_token_count=50, candidates_token_count=5),
        model_version="fake-model",
    )


def calls(*pairs: tuple[str, dict]) -> LlmResponse:
    """Several tool calls in one model turn (independent lookups going out together)."""
    parts = [types.Part(function_call=types.FunctionCall(name=name, args=args)) for name, args in pairs]
    return LlmResponse(
        content=types.Content(role="model", parts=parts),
        usage_metadata=types.GenerateContentResponseUsageMetadata(prompt_token_count=50, candidates_token_count=5),
        model_version="fake-model",
    )


# ── Show NoX: a screen recording of the trade desk, as Perceive and Ground would describe it ──

OBSERVATION = {
    "summary": "The author opens trade T-4471 on the trade desk. It was partially filled, but its status stays "
               "Pending settlement. They expected it to show Partially settled.",
    "kind_of_request": "bug",
    "transcript": [{"t": 2.0, "speaker": "author", "text": "This is trade T-4471, mail me at jo@apex.example"},
                   {"t": 40.0, "speaker": "author", "text": "See, it still says pending."}],
    "moments": [{"t": 12.0, "what": "Opens trade T-4471", "screen_text": ["T-4471"], "is_problem": False},
                {"t": 42.0, "what": "Status stays Pending settlement after a partial fill",
                 "screen_text": ["PENDING_SETTLEMENT"], "is_problem": True}],
    "screens": [{"t": 12.0, "title": "Apex trade desk", "visible_text": ["Trade blotter", "PENDING_SETTLEMENT"]}],
    "identifiers": ["PENDING_SETTLEMENT", "T-4471"],
    "expected": "Partially settled", "actual": "Pending settlement",
    "steps": ["Open the blotter", "Open trade T-4471"],
    "sensitive": ["email addresses"],
}


def grounding(app: str, *, ref: str = "entities/refund", code: str = "src/refund.py:3", **extra) -> dict:
    """What the Ground agent answers after its lookups (refs and code locations are post-checked)."""
    return {
        "apps": [{"app": app, "confidence": "high", "why": "The status string lives in its code."}],
        "findings": [{"ref": f"{app}/{ref}", "says": "A refund reverses a settled payment.", "relevance": "Explains the status.", "moment_t": 42.0}],
        "code": [{"app": app, "location": code, "snippet": "PENDING_SETTLEMENT", "moment_t": 42.0}],
        "contracts": [{"app": app, "identifier": "order.refunded", "direction": "exposes"}],
        "explanation": "The knowledge base says the status only changes after the ledger entry is written.",
        "likely": "intended_behaviour",
        "open_questions": ["Is T-4471 filled on the buy side or the sell side?"],
        "suggested_request": "Show a partly filled trade as partly settled on the trade desk.",
        **extra,
    }


def seat_views() -> dict:
    view = lambda s: {"summary": s, "moments": [{"t": 42.0, "what": "Status stays pending"}], "findings": []}  # noqa: E731
    return {"business": view("Customers see pending."), "product": view("Rule: partial fills stay pending."),
            "engineering": view("Status set by the settlement consumer."), "developer": view("See src/refund.py:3.")}


class FakeLlm(BaseLlm):
    """Replies from a script: a list of responses, or a function of the request."""

    model: str = "fake-model"
    script: list | None = None
    responder: Callable[[LlmRequest], LlmResponse] | None = None
    requests: list = []

    async def generate_content_async(self, llm_request: LlmRequest, stream: bool = False) -> AsyncGenerator[LlmResponse, None]:
        self.requests.append(llm_request)
        if self.responder is not None:
            yield self.responder(llm_request)
        elif self.script:
            yield self.script.pop(0)
        else:
            raise AssertionError("FakeLlm ran out of scripted responses")


class SlowFakeLlm(FakeLlm):
    """A FakeLlm whose calls take a moment, counting how many are in flight at once (for concurrency limits)."""

    delay: float = 0.02
    in_flight: int = 0
    peak: int = 0

    async def generate_content_async(self, llm_request: LlmRequest, stream: bool = False) -> AsyncGenerator[LlmResponse, None]:
        import asyncio

        self.in_flight += 1
        self.peak = max(self.peak, self.in_flight)
        try:
            await asyncio.sleep(self.delay)
        finally:
            self.in_flight -= 1
        async for r in super().generate_content_async(llm_request, stream):
            yield r


def request_text(req: LlmRequest) -> str:
    """Everything the model was shown in one request (for asserting on prompts)."""
    out = [str(req.config.system_instruction or "")] if req.config else []
    for c in req.contents or []:
        for p in c.parts or []:
            if p.text:
                out.append(p.text)
            if p.function_response:
                out.append(json.dumps(p.function_response.response, default=str))
    return "\n".join(out)


def use_fake(monkeypatch, fake: FakeLlm) -> FakeLlm:
    """Route every NoX agent (any tier, and local) to `fake`."""
    from nox_api.ai import config

    monkeypatch.setattr(config, "model", lambda tier=None: fake)
    monkeypatch.setattr(config, "local_model", lambda: fake)
    return fake
