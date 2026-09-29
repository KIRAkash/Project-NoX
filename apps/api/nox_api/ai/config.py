"""Which models NoX's agents run on, and where.

One switch (`NOX_AI_BACKEND`) decides for every agent, for embeddings and for context caches:

  enterprise  Gemini on the Gemini Enterprise Agent Platform (formerly Vertex AI), authenticated by the
              Cloud Run service account: no API key anywhere. Default whenever a GCP project is configured.
  api_key     Gemini Developer API with GEMINI_API_KEY, for local development without GCP credentials.
  local       Gemma via Ollama (NoX Local): the same agents, and source code never leaves the machine.

Agents ask for a tier, not a model name, so the model per job is configuration:
  FAST     small structured calls (gatekeeper, classification)
  DEFAULT  most writing (pages, specs, answers)
  DEEP     whole-codebase reasoning (architecture map, org rollup)
"""

from __future__ import annotations

import os
from enum import Enum

from google.genai import types

from ..core.config import settings


class Tier(str, Enum):
    FAST = "fast"
    DEFAULT = "default"
    DEEP = "deep"


def backend() -> str:
    chosen = settings.NOX_AI_BACKEND.strip().lower()
    if chosen in ("enterprise", "vertex", "vertexai"):
        return "enterprise"
    if chosen in ("api_key", "local"):
        return chosen
    return "enterprise" if project() else "api_key"


def project() -> str:
    return settings.GOOGLE_CLOUD_PROJECT or settings.GCP_PROJECT_ID or os.getenv("GOOGLE_CLOUD_PROJECT", "")


def model_name(tier: Tier = Tier.DEFAULT) -> str:
    if tier == Tier.FAST:
        return settings.NOX_MODEL_FAST or settings.GEMINI_MODEL
    if tier == Tier.DEEP:
        return settings.NOX_MODEL_DEEP or settings.GEMINI_MODEL
    return settings.GEMINI_MODEL


def _client_kwargs() -> dict:
    if backend() == "enterprise":
        return {"enterprise": True, "project": project(), "location": settings.GOOGLE_CLOUD_LOCATION}
    return {"api_key": settings.GEMINI_API_KEY}


_RETRY = types.HttpRetryOptions(attempts=4, initial_delay=1.0, max_delay=20.0, exp_base=2.0)


def model(tier: Tier = Tier.DEFAULT):
    """The ADK model object for a tier. On Gemini, a failed primary falls back to GEMINI_BACKUP_MODEL."""
    if backend() == "local":
        return local_model()

    from google.adk.models import Gemini

    primary = Gemini(model=model_name(tier), client_kwargs=_client_kwargs(), retry_options=_RETRY)
    backup = settings.GEMINI_BACKUP_MODEL
    if not backup or backup == primary.model:
        return primary

    import warnings

    from google.adk.models import FallbackModel

    with warnings.catch_warnings():  # FallbackModel is marked experimental
        warnings.simplefilter("ignore")
        return FallbackModel(models=[primary, Gemini(model=backup, client_kwargs=_client_kwargs(), retry_options=_RETRY)])


def local_model():
    """Gemma through Ollama. Gemma 3 needs ADK's function-calling shim; later Gemma speaks tools natively."""
    try:
        from google.adk.models.lite_llm import LiteLlm
    except ImportError as e:  # litellm is the `local` extra
        raise RuntimeError("NoX Local needs the local extra: uv sync --extra local") from e

    os.environ.setdefault("OLLAMA_API_BASE", settings.GEMMA_OLLAMA_URL)
    name = settings.NOX_LOCAL_MODEL
    opts = {"num_ctx": settings.NOX_LOCAL_NUM_CTX}  # passed through to Ollama; its 4096 default truncates prompts
    if not settings.NOX_LOCAL_THINK:
        opts["reasoning_effort"] = "none"  # LiteLLM → Ollama think=false: no hidden reasoning tokens before the answer
    if "gemma3" in name:
        from google.adk.models.gemma_llm import Gemma3Ollama

        return Gemma3Ollama(model=name.replace("ollama_chat/", "ollama/"), **opts)
    return LiteLlm(model=name, **opts)


_clients: dict = {}


def genai_client():
    """A plain google-genai client on the same backend, for embeddings and context caches (one per event loop)."""
    import asyncio

    from google import genai

    if backend() == "local":
        raise RuntimeError("No Gemini client in local mode")
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    for stale in [k for k in _clients if k is not None and k.is_closed()]:
        _clients.pop(stale)
    if loop not in _clients:
        _clients[loop] = genai.Client(**_client_kwargs())
    return _clients[loop]


def describe() -> str:
    """One line for logs and the health endpoint."""
    b = backend()
    if b == "local":
        return f"local · {settings.NOX_LOCAL_MODEL}"
    where = f"{project()}/{settings.GOOGLE_CLOUD_LOCATION}" if b == "enterprise" else "developer API"
    return f"{b} ({where}) · {model_name()}"
