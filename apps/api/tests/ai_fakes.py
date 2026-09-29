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
