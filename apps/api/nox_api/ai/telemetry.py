"""What each piece of AI work cost: model calls, tokens, cache hits and wall time.

A `usage_scope()` wraps one unit of work (a KB build, an Ask turn, a co-writer turn). Every model response
inside it adds to the same `Usage`, however many agents and parallel tasks are involved, because the scope
lives in a context variable that asyncio tasks inherit. The totals go to the log as one structured line
(which Cloud Logging indexes) and back to the caller for the UI.
"""

from __future__ import annotations

import contextvars
import json
import logging
import time
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field

logger = logging.getLogger("nox.ai.usage")


@dataclass
class Usage:
    label: str = ""
    calls: int = 0
    input_tokens: int = 0
    cached_tokens: int = 0
    output_tokens: int = 0
    thinking_tokens: int = 0
    embedded_tokens: int = 0
    tool_calls: int = 0
    started: float = field(default_factory=time.monotonic)
    seconds: float = 0.0
    models: dict[str, int] = field(default_factory=dict)

    def add_response(self, usage_metadata, model: str | None = None) -> None:
        """Count one model response (anything with google-genai usage metadata)."""
        self.calls += 1
        if model:
            self.models[model] = self.models.get(model, 0) + 1
        if usage_metadata is None:
            return
        self.input_tokens += getattr(usage_metadata, "prompt_token_count", None) or 0
        self.cached_tokens += getattr(usage_metadata, "cached_content_token_count", None) or 0
        self.output_tokens += getattr(usage_metadata, "candidates_token_count", None) or 0
        self.thinking_tokens += getattr(usage_metadata, "thoughts_token_count", None) or 0

    @property
    def cached_share(self) -> float:
        return self.cached_tokens / self.input_tokens if self.input_tokens else 0.0

    def finish(self) -> Usage:
        self.seconds = round(time.monotonic() - self.started, 2)
        return self

    def summary(self) -> dict:
        d = asdict(self)
        d.pop("started")
        d["cached_share"] = round(self.cached_share, 3)
        return d

    def line(self) -> str:
        """Short human line for the UI, e.g. '14 calls · 212k tokens · 61% cached · 38s'."""
        parts = [f"{self.calls} calls", f"{_k(self.input_tokens + self.output_tokens)} tokens"]
        if self.cached_tokens:
            parts.append(f"{round(100 * self.cached_share)}% cached")
        parts.append(f"{self.seconds:.0f}s")
        return " · ".join(parts)


def _k(n: int) -> str:
    return f"{n / 1000:.0f}k" if n >= 1000 else str(n)


_current: contextvars.ContextVar[Usage | None] = contextvars.ContextVar("nox_ai_usage", default=None)


def current() -> Usage | None:
    return _current.get()


@contextmanager
def usage_scope(label: str):
    """Collect usage for everything inside; nested scopes also count toward their parent."""
    parent = _current.get()
    usage = Usage(label=label)
    token = _current.set(usage)
    try:
        yield usage
    finally:
        _current.reset(token)
        usage.finish()
        if parent is not None:
            for k in ("calls", "input_tokens", "cached_tokens", "output_tokens", "thinking_tokens", "embedded_tokens", "tool_calls"):
                setattr(parent, k, getattr(parent, k) + getattr(usage, k))
            for m, n in usage.models.items():
                parent.models[m] = parent.models.get(m, 0) + n
        logger.info(json.dumps({"event": "nox.ai.usage", **usage.summary()}))


def record_response(usage_metadata, model: str | None = None) -> None:
    if (u := _current.get()) is not None:
        u.add_response(usage_metadata, model)


def record_tool_call() -> None:
    if (u := _current.get()) is not None:
        u.tool_calls += 1


def record_embedding(tokens: int) -> None:
    if (u := _current.get()) is not None:
        u.embedded_tokens += tokens
