"""Running NoX's ADK agents: one-shot runs, streamed runs, and sessions.

Everything that touches `google.adk.runners` goes through here, so the rest of NoX sees two calls:

  result = await run(agent, "message", state={...})          → final text + parsed output + usage
  async for ev in stream(agent, "message", session=...):     → step / delta / done events for SSE

`run` also takes an ADK 2 `Workflow` as its root (the knowledge-base builder). Conversations (`stream`: Ask and the
co-writer) get explicit context caching when NOX_CONTEXT_CACHE is on; one-shot pipeline runs rely on implicit caching.

State passed in `state` is where tools read their scope (which knowledge bases the caller may see, which
mission file is being edited). It is set by NoX, never by the model.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from google.genai import types

from ..core.config import settings
from . import telemetry

logger = logging.getLogger(__name__)

APP_NAME = "nox"
_ADK_SCHEMA = "adk"


@dataclass
class AgentResult:
    text: str = ""
    output: Any = None           # parsed `output_schema` value when the agent has one (via output_key)
    state: dict = field(default_factory=dict)
    tool_calls: list[dict] = field(default_factory=list)


# ── Sessions ────────────────────────────────────────────────────────────────

_ephemeral = None
_persistent: dict = {}  # event loop → session service (each Celery task runs its own loop)


def ephemeral_sessions():
    """In-memory sessions for one-shot pipeline runs (nothing to remember afterwards)."""
    global _ephemeral
    if _ephemeral is None:
        from google.adk.sessions import InMemorySessionService

        _ephemeral = InMemorySessionService()
    return _ephemeral


async def persistent_sessions():
    """Conversations that must survive across requests and Cloud Run instances (Ask, co-writer chat).

    ADK's tables live in their own Postgres schema so their generic names never meet NoX's.
    Falls back to memory if the database can't host them (e.g. SQLite in a test).
    """
    import asyncio

    loop = asyncio.get_running_loop()
    for stale in [k for k in _persistent if k.is_closed()]:
        _persistent.pop(stale)
    if loop in _persistent:
        return _persistent[loop]
    url = settings.DATABASE_URL
    if not url.startswith("postgresql"):
        return ephemeral_sessions()
    try:
        from google.adk.sessions import DatabaseSessionService
        from sqlalchemy import text
        from sqlalchemy.ext.asyncio import create_async_engine

        engine = create_async_engine(url, connect_args={"server_settings": {"search_path": _ADK_SCHEMA}}, pool_pre_ping=True)
        async with engine.begin() as conn:
            await conn.execute(text(f"CREATE SCHEMA IF NOT EXISTS {_ADK_SCHEMA}"))
        _persistent[loop] = DatabaseSessionService(db_engine=engine)
    except Exception as e:
        logger.warning(f"ADK database sessions unavailable ({e}); using in-memory sessions")
        _persistent[loop] = ephemeral_sessions()
    return _persistent[loop]


async def ensure_session(service, user_id: str, session_id: str, state: dict | None = None) -> str:
    """Get or create a session; fresh scope from NoX always overrides what the session remembered."""
    session = await service.get_session(app_name=APP_NAME, user_id=user_id, session_id=session_id)
    if session is None:
        await service.create_session(app_name=APP_NAME, user_id=user_id, session_id=session_id, state=state or {})
    return session_id


# ── Running ─────────────────────────────────────────────────────────────────

def _message(text: str, parts: list | None = None) -> types.Content:
    return types.Content(role="user", parts=[types.Part(text=text), *(parts or [])])


def _runner(agent, service, *, cache: bool = False):
    """A runner for an agent or any ADK 2 root node (a `Workflow`). `cache` adds explicit context caching."""
    from google.adk.agents import BaseAgent
    from google.adk.runners import Runner

    if cache:
        from google.adk.apps import App

        return Runner(app=App(name=APP_NAME, root_agent=agent, context_cache_config=context_cache_config()),
                      session_service=service)
    if isinstance(agent, BaseAgent):
        return Runner(app_name=APP_NAME, agent=agent, session_service=service)
    return Runner(app_name=APP_NAME, node=agent, session_service=service)


def context_cache_on() -> bool:
    from . import config

    return settings.NOX_CONTEXT_CACHE and config.backend() != "local"


def context_cache_config():
    """Explicit Gemini context caches for conversations: ADK caches the stable prefix (instruction, earlier turns,
    tool results) from a session's second model request on, once it passes the model's minimum size."""
    import warnings

    from google.adk.agents.context_cache_config import ContextCacheConfig

    with warnings.catch_warnings():  # marked experimental in ADK 2.10
        warnings.simplefilter("ignore")
        return ContextCacheConfig(min_tokens=4096, ttl_seconds=600, cache_intervals=10)


def _account(event) -> None:
    """Count a completed model response and any tool calls in it (streamed partials are counted once, whole)."""
    if event.partial:
        return
    if event.usage_metadata is not None:
        telemetry.record_response(event.usage_metadata, event.model_version)
    for call in event.get_function_calls() or []:
        if call.name != "set_model_response":
            telemetry.record_tool_call()


async def run(agent, message: str, *, state: dict | None = None, user_id: str = "nox",
              session_id: str | None = None, sessions=None, parts: list | None = None) -> AgentResult:
    """Run an agent to completion and return its final answer."""
    service = sessions or ephemeral_sessions()
    sid = session_id or uuid.uuid4().hex
    if session_id:
        await ensure_session(service, user_id, sid, state)
        state_delta = state
    else:
        await service.create_session(app_name=APP_NAME, user_id=user_id, session_id=sid, state=state or {})
        state_delta = None

    result = AgentResult()
    async for event in _runner(agent, service).run_async(user_id=user_id, session_id=sid, new_message=_message(message, parts),
                                                          state_delta=state_delta):
        _account(event)
        for call in event.get_function_calls() or []:
            result.tool_calls.append({"name": call.name, "args": dict(call.args or {})})
        if event.is_final_response() and event.content and event.content.parts:
            text = "".join(p.text or "" for p in event.content.parts if not getattr(p, "thought", False))
            if text:
                result.text = text
        if event.output is not None:
            result.output = event.output

    session = await service.get_session(app_name=APP_NAME, user_id=user_id, session_id=sid)
    result.state = dict(session.state) if session else {}
    output_key = getattr(agent, "output_key", None)
    if output_key and output_key in result.state:
        result.output = result.state[output_key]
    if not session_id:  # one-shot: don't keep it around
        await service.delete_session(app_name=APP_NAME, user_id=user_id, session_id=sid)
    return result


async def stream(agent, message: str, *, state: dict | None = None, user_id: str = "nox",
                 session_id: str | None = None, sessions=None, parts: list | None = None,
                 cache: bool | None = None) -> AsyncIterator[dict]:
    """Run an agent with token streaming and yield UI-ready events:

      {"type": "step", "tool": name, "args": {...}}      a tool call started
      {"type": "tool_result", "tool": name, "result": …} its result (for citations; not shown raw)
      {"type": "delta", "text": "…"}                      answer text as it is generated
      {"type": "done", "text": full_answer, "state": the session state after the run}
    """
    from google.adk.agents import RunConfig
    from google.adk.agents.run_config import StreamingMode

    service = sessions or await persistent_sessions()
    sid = session_id or uuid.uuid4().hex
    await ensure_session(service, user_id, sid, state)
    state = state if session_id else None  # a fresh session already starts with it

    answer = ""      # everything shown to the user, across model turns
    turn = ""        # text streamed in the current model turn
    async for event in _runner(agent, service, cache=context_cache_on() if cache is None else cache).run_async(
        user_id=user_id, session_id=sid, new_message=_message(message, parts), state_delta=state,
        run_config=RunConfig(streaming_mode=StreamingMode.SSE),
    ):
        _account(event)
        parts = event.content.parts if event.content and event.content.parts else []
        if event.partial:
            for p in parts:
                if p.text and not getattr(p, "thought", False):
                    turn += p.text
                    answer += p.text
                    yield {"type": "delta", "text": p.text}
            continue
        # A complete event closes the turn: send whatever of its text wasn't streamed (non-streaming models).
        text = "".join(p.text for p in parts if p.text and not getattr(p, "thought", False))
        if text and text.startswith(turn) and len(text) > len(turn):
            rest = text[len(turn):]
            answer += rest
            yield {"type": "delta", "text": rest}
        turn = ""
        for p in parts:
            if p.function_call and p.function_call.name != "set_model_response":
                yield {"type": "step", "tool": p.function_call.name, "args": dict(p.function_call.args or {})}
            elif p.function_response:
                yield {"type": "tool_result", "tool": p.function_response.name, "result": p.function_response.response}
    session = await service.get_session(app_name=APP_NAME, user_id=user_id, session_id=sid)
    final_state = dict(session.state) if session else {}
    if not session_id:  # one-shot: don't keep it around
        await service.delete_session(app_name=APP_NAME, user_id=user_id, session_id=sid)
    yield {"type": "done", "text": answer, "session_id": sid, "state": final_state}
