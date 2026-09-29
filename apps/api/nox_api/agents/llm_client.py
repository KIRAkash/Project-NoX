"""
Shared LLM client for the NoX KB pipeline.

All agents (ingestor, compiler, gatekeeper, rollup) import from here
instead of duplicating LLM boilerplate.

Key design points:
- Singleton: one instance shared across the process.
- google-genai: uses the new google.genai SDK (replaces deprecated google-generativeai).
  A single genai.Client is created once and reused — no repeated configure() calls.
  client.aio.models.generate_content() is natively async.
- httpx.AsyncClient for Ollama is kept alive with connection pooling.
- `force_mode` lets hybrid routing override the global AI_MODE per call:
    None      -> use settings.AI_MODE (or "remote" if AI_MODE == "hybrid" and no override)
    "local"   -> always Gemma / Ollama
    "remote"  -> always Gemini Flash
"""

import asyncio
import logging
from typing import Literal, Optional

import httpx

from ..ai.telemetry import record_response
from ..core.config import get_env_var, settings

logger = logging.getLogger(__name__)

ForceMode = Optional[Literal["local", "remote"]]


class LLMClient:
    """Thread-safe (asyncio) singleton that wraps both local and remote LLMs."""

    def __init__(self) -> None:
        self._gemini_client = None                       # google.genai.Client — created once
        self._ollama_client: httpx.AsyncClient | None = None  # keepalive

    # ── Mode resolution ─────────────────────────────────────────────────────

    def _effective_mode(self, force_mode: ForceMode) -> Literal["local", "remote"]:
        """Resolve the active execution mode for a single call."""
        if force_mode in ("local", "remote"):
            return force_mode
        active_ai_mode = get_env_var("AI_MODE", getattr(settings, "AI_MODE", "remote"))
        if active_ai_mode in ("local", "remote"):
            return active_ai_mode
        return "remote"   # hybrid default

    # ── Client accessors ────────────────────────────────────────────────────

    def _get_gemini_client(self):
        """Return the cached google.genai.Client, creating it once."""
        if self._gemini_client is None:
            from ..ai.config import describe, genai_client

            self._gemini_client = genai_client()  # same backend as the ADK agents (Agent Platform or API key)
            logger.info(f"Gemini client initialised: {describe()}")
        return self._gemini_client

    async def _get_ollama_client(self) -> httpx.AsyncClient:
        """Return the long-lived httpx client for Ollama."""
        if self._ollama_client is None or self._ollama_client.is_closed:
            self._ollama_client = httpx.AsyncClient(
                base_url=settings.GEMMA_OLLAMA_URL,
                timeout=None,
                limits=httpx.Limits(max_connections=4, max_keepalive_connections=2),
            )
        return self._ollama_client

    # ── Public interface ────────────────────────────────────────────────────

    async def generate(
        self,
        prompt: str,
        system: str = "",
        force_json: bool = False,
        force_mode: ForceMode = None,
        num_ctx_override: int | None = None,
        images: list | None = None,
    ) -> str:
        """Generate a response from the appropriate LLM.

        Args:
            prompt:           User/task prompt.
            system:           System instruction. Prepended inline for Ollama;
                              passed as system_instruction in GenerateContentConfig
                              for Gemini.
            force_json:       Request structured JSON output.
            force_mode:       Override AI_MODE for this call ("local" or "remote").
                              Essential for hybrid per-task routing.
            num_ctx_override: Ollama-only — override num_ctx for this call.
            images:           List of image bytes (only supported for Gemini remote mode).
        """
        mode = self._effective_mode(force_mode)
        if mode == "local":
            return await self._generate_local(prompt, system, force_json, num_ctx_override)
        return await self._generate_remote(prompt, system, force_json, images)

    async def generate_batch(
        self,
        items: list,
        semaphore_limit: int = None,
        force_mode: ForceMode = None,
    ) -> list:
        """Run multiple generate() calls with rate limiting and concurrency control.

        Args:
            items:           List of dicts. Required key: "prompt".
                             Optional keys: "system", "force_json", "num_ctx_override", "images".
            semaphore_limit: Max concurrent LLM calls.
            force_mode:      Passed through to every generate() call.
        """
        effective_mode = self._effective_mode(force_mode)
        is_safe_mode = get_env_var("GEMINI_RATE_LIMIT_SAFE_MODE", "true").lower() in ("true", "1", "yes")
        try:
            delay_seconds = float(get_env_var("GEMINI_REQUEST_DELAY_SECONDS", "1.5"))
        except ValueError:
            delay_seconds = 1.5

        # In safe mode on remote, serialize with pacing delays to prevent 429 quota exhaustion
        if effective_mode == "remote" and is_safe_mode:
            logger.info(f"[llm_client] Safe mode active: executing {len(items)} remote requests sequentially with pacing delays.")
            results = []
            for item in items:
                res = await self.generate(
                    prompt=item["prompt"],
                    system=item.get("system", ""),
                    force_json=item.get("force_json", False),
                    force_mode=force_mode,
                    num_ctx_override=item.get("num_ctx_override"),
                    images=item.get("images"),
                )
                results.append(res)
                if delay_seconds > 0:
                    await asyncio.sleep(delay_seconds)
            return results

        try:
            max_conc = int(get_env_var("GEMINI_MAX_CONCURRENCY", "2"))
        except ValueError:
            max_conc = 2
        limit = semaphore_limit or max_conc or getattr(settings, "REMOTE_SEMAPHORE_LIMIT", 2)
        sem = asyncio.Semaphore(limit)

        async def _guarded(item: dict) -> str:
            async with sem:
                res = await self.generate(
                    prompt=item["prompt"],
                    system=item.get("system", ""),
                    force_json=item.get("force_json", False),
                    force_mode=force_mode,
                    num_ctx_override=item.get("num_ctx_override"),
                    images=item.get("images"),
                )
                if effective_mode == "remote" and delay_seconds > 0:
                    await asyncio.sleep(delay_seconds)
                return res

        return list(await asyncio.gather(*[_guarded(item) for item in items]))

    async def close(self) -> None:
        """Close long-lived connections (call on application shutdown)."""
        if self._ollama_client and not self._ollama_client.is_closed:
            await self._ollama_client.aclose()

    # ── Private: Ollama ─────────────────────────────────────────────────────

    async def _generate_local(
        self,
        prompt: str,
        system: str,
        force_json: bool,
        num_ctx_override: int | None,
    ) -> str:
        client = await self._get_ollama_client()
        full_prompt = f"{system}\n\n{prompt}" if system else prompt
        num_ctx = num_ctx_override or 16384
        model_name = get_env_var("GEMMA_MODEL", getattr(settings, "GEMMA_MODEL", "gemma3:12b"))

        payload: dict = {
            "model": model_name,
            "prompt": full_prompt,
            "stream": False,
            "options": {"num_ctx": num_ctx},
        }
        if force_json:
            payload["format"] = "json"

        for attempt in range(3):
            try:
                response = await client.post("/api/generate", json=payload)
                if response.status_code == 200:
                    return response.json().get("response", "")
                logger.error(f"Ollama error {response.status_code}: {response.text}")
                return ""
            except (httpx.ReadTimeout, httpx.ConnectError) as e:
                if attempt < 2:
                    wait = 2 ** attempt
                    logger.warning(f"Ollama connection error (attempt {attempt+1}), retrying in {wait}s: {e}")
                    await asyncio.sleep(wait)
                else:
                    logger.error(f"Ollama failed after 3 attempts: {e}")
                    return ""
        return ""

    # ── Private: Gemini (google-genai SDK) ──────────────────────────────────

    async def _generate_remote(
        self,
        prompt: str,
        system: str,
        force_json: bool,
        images: list | None = None,
    ) -> str:
        """Call Gemini using the google-genai SDK via the natively-async client.aio interface."""
        import random

        from google.genai import types

        client = self._get_gemini_client()
        model_name = get_env_var("GEMINI_MODEL", getattr(settings, "GEMINI_MODEL", "gemini-3.5-flash-lite"))
        logger.info(f"[llm_client/remote] Invoking Gemini model: '{model_name}'")

        # Both system_instruction and response_mime_type live in GenerateContentConfig
        config_kwargs: dict = {
            "automatic_function_calling": types.AutomaticFunctionCallingConfig(disable=True),
            "max_output_tokens": 8192,
        }
        if system:
            config_kwargs["system_instruction"] = system
        if force_json:
            config_kwargs["response_mime_type"] = "application/json"
        config = types.GenerateContentConfig(**config_kwargs)
        
        contents = [prompt]
        if images:
            for img_bytes in images:
                # We assume png for raw bytes, or let genai auto-detect if possible
                contents.append(
                    types.Part.from_bytes(data=img_bytes, mime_type='image/png')
                )

        backup_model_name = get_env_var("GEMINI_BACKUP_MODEL", getattr(settings, "GEMINI_BACKUP_MODEL", None))
        
        for attempt in range(5):
            current_model = model_name
            # Fall back to backup model immediately after 1 failure to avoid 15s proxy timeouts
            if attempt >= 1 and backup_model_name:
                current_model = backup_model_name
                if attempt == 1:
                    logger.info(f"[llm_client/remote] Primary model '{model_name}' failed. Immediately falling back to backup model: '{current_model}'")
                    
            try:
                response = await client.aio.models.generate_content(
                    model=current_model,
                    contents=contents,
                    config=config,
                )
                record_response(response.usage_metadata, current_model)
                return response.text or ""
            except Exception as e:
                err_str = str(e)
                is_rate_limit = any(tok in err_str for tok in ("429", "RESOURCE_EXHAUSTED", "quota"))
                is_transient  = any(tok in err_str for tok in ("503", "UNAVAILABLE", "DNS", "timeout"))
                if (is_rate_limit or is_transient) and attempt < 4:
                    # Apply exponential backoff with jitter for BOTH rate limits and 503 overloads
                    base_wait = (2 ** attempt) if is_transient else 4 * (2 ** attempt)
                    wait = base_wait + random.uniform(0.5, 2.0)
                    logger.warning(
                        f"Gemini {'rate limit (429)' if is_rate_limit else 'transient error (503/timeout)'} on '{current_model}' (attempt {attempt+1}/5), "
                        f"backing off exponentially for {wait:.1f}s: {e}"
                    )
                    await asyncio.sleep(wait)
                else:
                    logger.error(f"Gemini generation failed: {e}")
                    raise
        return ""


# Module-level singleton — import this everywhere
llm_client = LLMClient()
