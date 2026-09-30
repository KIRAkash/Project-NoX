"""NoX's Ask agent over A2A, so other enterprise agents can ask NoX questions as a peer.

Built with ADK's `to_a2a` and served at `/a2a/ask`; the agent card is public at
`/a2a/ask/.well-known/agent-card.json`. Everything else needs a NoX token.

Scope is the hard part: A2A requests arrive without NoX's session state. So:
  1. `A2AGate` (ASGI) resolves `Authorization: Bearer nox_…` + `X-Nox-Role` to the caller's visible applications
     and puts them in a context variable for the duration of the request (401 without a valid token).
  2. A `before_agent_callback` copies that scope into the session state on every turn, overwriting whatever
     the session holds (the rule `ai/runtime.ensure_session` follows). No scope → "Sign in with a NoX token",
     no model call. It also runs the question past NoX Shield, like Ask in the app.
  3. Sessions are keyed by the NoX user, not only the A2A context id, so one caller never continues another's.
The agent runs without `get_jira_issue` (NoX's own Jira credentials), and its model is resolved per call from the
configured tier, so tests and NoX's backend switch apply.
"""

from __future__ import annotations

import contextvars
import logging
import warnings
from contextlib import asynccontextmanager
from typing import Any

from google.adk.agents import LlmAgent
from google.adk.models import LlmCapabilities
from google.adk.models.base_llm import BaseLlm
from google.genai import types
from starlette.responses import JSONResponse

from ..ai import config, telemetry
from ..ai.agents import ask
from ..core.config import settings
from ..db.database import AsyncSessionLocal
from ..services.scope import LOGIN_HINT, ScopeError, actor_from_token, tool_state

logger = logging.getLogger("nox.a2a")

PATH = "/a2a/ask"
CARD_PATH = f"{PATH}/.well-known/agent-card.json"
SIGN_IN = "Sign in with a NoX token: send `Authorization: Bearer nox_…` (run `nox login`, then `nox mcp`)."

_scope: contextvars.ContextVar[dict | None] = contextvars.ContextVar("nox_a2a_scope", default=None)


class _TierModel(BaseLlm):
    """Resolves NoX's DEFAULT tier at call time (Gemini on Agent Platform, the Developer API, or Gemma)."""

    model: str = "nox-default-tier"

    @property
    def capabilities(self) -> LlmCapabilities:
        return LlmCapabilities(output_schema_and_tools=False)

    async def generate_content_async(self, llm_request, stream: bool = False):
        real = config.model(config.Tier.DEFAULT)
        async for response in real.generate_content_async(llm_request, stream=stream):
            yield response


def _text(content: types.Content | None) -> str:
    return "".join(p.text or "" for p in (content.parts if content and content.parts else []))


async def _inject_scope(callback_context) -> types.Content | None:
    """Copy the caller's scope into state (overwriting the session), or end the turn with no model call."""
    from ..services import shield

    scope = _scope.get()
    if not scope:
        return types.Content(role="model", parts=[types.Part(text=SIGN_IN)])
    callback_context.state["apps"] = scope["apps"]
    callback_context.state["home_app"] = ""
    callback_context.state["role"] = scope["role"]
    callback_context.state["cited"] = []
    verdict = await shield.screen_prompt(_text(callback_context.user_content), where="a2a")
    if verdict.blocked:
        return types.Content(role="model", parts=[types.Part(text=ask.REFUSAL)])
    return None


def build_agent() -> LlmAgent:
    return LlmAgent(
        name="nox_ask",
        description=("Answers questions about the company's software applications from NoX's knowledge bases, "
                     "contract map and source snapshots, citing knowledge-base pages as [[kb:app/page]]."),
        model=_TierModel(),
        instruction=ask.peer_instruction,
        tools=ask.PEER_TOOLS,
        before_agent_callback=_inject_scope,
    )


def public_url() -> str:
    return (settings.NOX_PUBLIC_API_URL or settings.WEBHOOK_BASE_URL).rstrip("/")


def _executor_factory(runner):
    """A2A's default executor, with sessions keyed by the NoX user from the token."""
    from google.adk.a2a.converters.request_converter import convert_a2a_request_to_agent_run_request
    from google.adk.a2a.executor.a2a_agent_executor import A2aAgentExecutor
    from google.adk.a2a.executor.config import A2aAgentExecutorConfig

    def convert(request, part_converter=None, **kw):
        run = convert_a2a_request_to_agent_run_request(request, **({"part_converter": part_converter} if part_converter else {}))
        scope = _scope.get()
        if scope:
            run.user_id = f"nox-{scope['user_id']}"
        return run

    return A2aAgentExecutor(runner=runner, config=A2aAgentExecutorConfig(request_converter=convert))


class A2AGate:
    """ASGI: the public agent card, and token-scoped JSON-RPC. `app` is set when the API starts."""

    def __init__(self):
        self.app = None

    async def __call__(self, scope, receive, send):
        if self.app is None:
            return await JSONResponse({"error": "A2A is starting"}, status_code=503)(scope, receive, send)
        if scope["type"] != "http" or (scope.get("method") == "GET" and scope.get("path") == CARD_PATH):
            return await self.app(scope, receive, send)
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        async with AsyncSessionLocal() as db:
            try:
                actor = await actor_from_token(db, headers.get("authorization"), headers.get("x-nox-role"))
            except ScopeError as e:
                return await JSONResponse({"error": str(e), "hint": LOGIN_HINT}, status_code=e.status)(scope, receive, send)
            state = await tool_state(db, actor)
        logger.info(f'{{"event": "nox.a2a.call", "user": "{actor.user.id}", "role": "{actor.role.value}"}}')
        token = _scope.set({"user_id": str(actor.user.id), "role": actor.role.value, "apps": state["apps"]})
        try:
            with telemetry.tags(where="a2a"):
                return await self.app(scope, receive, send)
        finally:
            _scope.reset(token)


gate = A2AGate()


@asynccontextmanager
async def lifespan() -> Any:
    """Build the agent card for the public URL, wire ADK's A2A routes, and serve them through the gate."""
    with warnings.catch_warnings():  # ADK marks its A2A support experimental
        warnings.simplefilter("ignore")
        from google.adk.a2a.utils.agent_card_builder import AgentCardBuilder
        from google.adk.a2a.utils.agent_to_a2a import to_a2a

        agent = build_agent()
        card = await AgentCardBuilder(agent=agent, rpc_url=f"{public_url()}{PATH}").build()
        app = to_a2a(agent, agent_card=card, rpc_path=PATH.strip("/"), agent_executor_factory=_executor_factory)
        async with app.router.lifespan_context(app):
            gate.app = app
            try:
                yield app
            finally:
                gate.app = None
