"""Speak instead of type: the transcriber agent behind every mic button in NoX.

Push-to-talk, not a live session: the person records, and the words stream into the box for them to edit and
send as usual. NoX never sends anything by itself.

The FAST Gemini model hears the recording with a vocabulary list built from what the caller can see (their
applications, teams and open missions), so "claims-intake" and "TWCLM-12" come out right where a generic
speech-to-text model writes "claims in take". Words in another language come back as spoken, with an English
version for the box's "Use English" chip.
"""

from __future__ import annotations

import re
from collections.abc import AsyncIterator

from google.genai import types
from pydantic import BaseModel, Field

from ...core.config import settings
from .. import config, runtime, structured, telemetry

INSTRUCTION = (
    "You write down what the speaker in the attached recording says, for a text box in NoX, a software delivery "
    "platform. Rules:\n"
    "- Write exactly what was said, in the language it was said in. Never summarise, answer, translate or add anything.\n"
    "- Use normal punctuation and capitalisation. Drop filler sounds (um, uh) and false starts.\n"
    "- Fix only obvious mishearings, using the vocabulary list: application names, teams, ticket and mission keys. "
    "Write those exactly as the list spells them.\n"
    "- If there is no speech, reply with nothing."
)


class Translation(BaseModel):
    language: str = Field(description="The language spoken, as an English name, e.g. Hindi")
    english: str = Field(description="The same words in natural English, nothing added")


def model_name() -> str:
    return settings.NOX_MODEL_TRANSCRIBE or config.model_name(config.Tier.FAST)


def _model():
    if settings.NOX_MODEL_TRANSCRIBE and config.backend() != "local":
        from google.adk.models import Gemini

        return Gemini(model=settings.NOX_MODEL_TRANSCRIBE, client_kwargs=config._client_kwargs(), retry_options=config._RETRY)
    return config.model(config.Tier.FAST)


def non_english(text: str) -> bool:
    """Mostly letters outside Latin script: worth offering an English version."""
    letters = [c for c in text if c.isalpha()]
    return bool(letters) and sum(1 for c in letters if ord(c) > 0x24F) / len(letters) > 0.3


async def transcribe(audio: bytes, mime: str, vocabulary: list[str]) -> AsyncIterator[dict]:
    """Yields {"type": "delta", "text"} as the words come, then {"type": "done", "text", "language", "english"}."""
    from google.adk.agents import LlmAgent

    agent = LlmAgent(name="nox_transcriber", model=_model(), instruction=INSTRUCTION, include_contents="none")
    vocab = ", ".join(dict.fromkeys(v for v in vocabulary if v))[:4000]
    text = ""
    with telemetry.usage_scope("voice:transcribe"):
        async for ev in runtime.stream(agent, f"Vocabulary: {vocab or '(none)'}\nTranscribe the recording.",
                                       parts=[types.Part.from_bytes(data=audio, mime_type=mime)],
                                       sessions=runtime.ephemeral_sessions(), cache=False):
            if ev["type"] == "delta":
                text += ev["text"]
                yield {"type": "delta", "text": ev["text"]}
            elif ev["type"] == "done":
                text = ev["text"] or text
        text = re.sub(r"\s+", " ", text).strip()
        language, english = None, None
        if text and non_english(text):
            try:
                t = await structured.ask(Translation, text, name="nox_translator", tier=config.Tier.FAST,
                                         instruction="Name the language of the text and give the same words in natural English.")
                language, english = t.language, t.english.strip()
            except Exception:  # the transcript stands on its own; the English chip just doesn't show
                pass
    yield {"type": "done", "text": text, "language": language, "english": english}
