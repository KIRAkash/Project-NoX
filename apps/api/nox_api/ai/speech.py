"""Listen: NoX reads a reply aloud with Gemini TTS, only when the person asks.

Not an agent (nothing to decide, no tools): one google-genai call, like embeddings, inside a usage scope. The
text is prepared for the ear first (no Markdown, wikilinks become their labels, code is skipped), and the audio is
cached under a hash of (text, voice, model), so playing the same reply again costs nothing.
"""

from __future__ import annotations

import hashlib
import re

from google.genai import types

from ..core.config import settings
from . import telemetry

MAX_CHARS = 1200
TAIL = " The rest is on screen."


def available() -> bool:
    from .config import backend

    return bool(settings.NOX_MODEL_TTS) and backend() != "local"


def for_the_ear(markdown: str) -> str:
    """What a person hears: the words, not the markup. Long replies stop after whole paragraphs."""
    t = re.sub(r"```.*?```", " ", markdown or "", flags=re.S)                    # code blocks
    t = re.sub(r"\[\[[^\]|]+\|([^\]]+)\]\]", r"\1", t)                            # [[target|label]] → label
    t = re.sub(r"\[\[(?:kb:|media:|memory:)?([^\]]+)\]\]", lambda m: _label(m.group(1)), t)
    t = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", t)                                # [text](url) → text
    t = re.sub(r"`([^`]+)`", r"\1", t)
    lines = []
    for line in t.splitlines():
        item = re.match(r"^\s{0,3}(#{1,6}\s*|[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)", line)
        line = re.sub(r"[*_~>|]", "", line[item.end():] if item else line).strip()
        if item and line and line[-1] not in ".!?:;":  # a heading or list item reads as its own sentence
            line += "."
        lines.append(line)
    t = "\n".join(lines)
    paras = [re.sub(r"\s+", " ", p).strip() for p in re.split(r"\n\s*\n", t)]
    paras = [p for p in paras if p]
    out = ""
    for p in paras:
        if len(out) + len(p) + 1 > MAX_CHARS:
            return (out.strip() or p[:MAX_CHARS].rsplit(" ", 1)[0]) + TAIL
        out += " " + p
    return out.strip()


def _label(target: str) -> str:
    if re.fullmatch(r"[0-9a-fA-F-]{36}(#.*)?", target):
        return ""  # a capture or lesson id: nothing worth saying
    return target.split("#")[0].rstrip("/").split("/")[-1].replace("-", " ").removesuffix(".md")


def cache_key(text: str) -> str:
    return hashlib.sha256(f"{settings.NOX_MODEL_TTS}|{settings.NOX_TTS_VOICE}|{text}".encode()).hexdigest()[:40]


async def synthesize(text: str) -> tuple[bytes, str]:
    """(audio bytes, mime type) for already-prepared text."""
    from .config import genai_client

    cfg = types.GenerateContentConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=settings.NOX_TTS_VOICE))),
    )
    with telemetry.usage_scope("voice:speak"):
        resp = await genai_client().aio.models.generate_content(model=settings.NOX_MODEL_TTS, contents=text, config=cfg)
        telemetry.record_response(resp.usage_metadata, settings.NOX_MODEL_TTS)
    for part in (resp.candidates[0].content.parts if resp.candidates and resp.candidates[0].content else []):
        if part.inline_data and part.inline_data.data:
            mime = part.inline_data.mime_type or "audio/wav"
            data = part.inline_data.data
            if mime.startswith("audio/L16") or mime.startswith("audio/pcm"):  # raw PCM from some models: wrap it
                data, mime = _wav(data, _rate(mime)), "audio/wav"
            return data, mime.split(";")[0]
    raise RuntimeError("The speech model returned no audio")


def _rate(mime: str) -> int:
    m = re.search(r"rate=(\d+)", mime)
    return int(m.group(1)) if m else 24000


def _wav(pcm: bytes, rate: int) -> bytes:
    import io
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()
