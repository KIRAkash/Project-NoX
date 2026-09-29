"""One-shot structured calls: an ADK agent whose answer is a Pydantic model."""

from __future__ import annotations

import json
import logging
import re

from pydantic import BaseModel, ValidationError

from . import config, runtime

logger = logging.getLogger(__name__)


def _parse[T: BaseModel](schema: type[T], output, text: str) -> T:
    if isinstance(output, schema):
        return output
    if isinstance(output, dict):
        return schema.model_validate(output)
    # Local models without constrained decoding sometimes wrap JSON in prose or fences.
    raw = text.strip()
    m = re.search(r"\{.*\}", raw, re.S)
    return schema.model_validate(json.loads(m.group(0) if m else raw))


async def ask[T: BaseModel](schema: type[T], prompt: str, *, name: str, instruction: str = "",
              tier: config.Tier = config.Tier.DEFAULT, local: bool = False, tools: list | None = None,
              state: dict | None = None, parts: list | None = None, static_instruction: str | None = None,
              generate_config=None) -> T:
    """Run a single-turn agent constrained to `schema` and return the validated value.

    `parts` go with the prompt (images, video, audio); `generate_config` is a `types.GenerateContentConfig`
    for the call, e.g. the media resolution a video is watched at.
    """
    from google.adk.agents import LlmAgent

    agent = LlmAgent(
        name=name,
        model=config.local_model() if local else config.model(tier),
        instruction=instruction,
        tools=tools or [],
        output_schema=schema,  # constrains Gemini; the final text is validated here (tolerant of local models)
        include_contents="none",
        static_instruction=static_instruction,
        generate_content_config=generate_config,
    )
    result = await runtime.run(agent, prompt, state=state, parts=parts)
    try:
        return _parse(schema, result.output, result.text)
    except (ValidationError, json.JSONDecodeError, TypeError) as e:
        logger.warning(f"{name}: output did not match {schema.__name__}: {e}")
        raise
