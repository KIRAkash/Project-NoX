"""Voice: push-to-talk transcription (limits, scope of the vocabulary, the stream) and Listen (for the ear, cache)."""

import json
import uuid

import httpx
import pytest

from nox_api.ai import speech
from nox_api.ai.agents import voice
from nox_api.core.config import settings
from nox_api.main import app
from tests.ai_fakes import FakeLlm, request_text, text, use_fake
from tests.test_missions import _setup_app

WEBM = b"\x1aE\xdf\xa3" + b"\x00" * 4000  # enough bytes to look like a recording; the fake model never decodes it


def _client(role: str = "business", email: str | None = None) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                             headers={"Authorization": f"Dev {email or f'v{uuid.uuid4().hex[:8]}@example.com'}", "X-Nox-Role": role})


def _sse(body: str) -> list[tuple[str, dict]]:
    out, event = [], None
    for line in body.splitlines():
        if line.startswith("event:"):
            event = line.split(":", 1)[1].strip()
        elif line.startswith("data:") and event:
            out.append((event, json.loads(line.split(":", 1)[1])))
    return out


@pytest.fixture(autouse=True)
def cloud_backend(monkeypatch):
    monkeypatch.setattr(settings, "NOX_AI_BACKEND", "api_key")
    monkeypatch.setattr(settings, "NOX_VOICE_PER_HOUR", 30)


def test_replies_are_prepared_for_the_ear():
    said = speech.for_the_ear("## Who calls it\n- **customer-portal** calls `POST /login` [[kb:claims-intake/entities/claim|the claim page]]"
                              "\n- [[memory:0b1e0b1e-0000-0000-0000-000000000000]]\n\n```py\nsecret = 1\n```\nBoth keep working.")
    assert said == "Who calls it. customer-portal calls POST /login the claim page. Both keep working."
    long = speech.for_the_ear("\n\n".join(["A sentence that goes on for a while."] * 80))
    assert len(long) <= speech.MAX_CHARS + len(speech.TAIL) and long.endswith("The rest is on screen.")


def test_non_english_detection():
    assert voice.non_english("ग्राहक को पांच बार गलत पासवर्ड")
    assert not voice.non_english("Lock the account after five failed attempts")
    assert not voice.non_english("Café crème, naïve résumé")


async def test_status_hides_voice_in_nox_local(db_clean, monkeypatch):
    async with _client() as c:
        assert (await c.get("/api/v1/voice/status")).json() == {"speak": True, "listen": True, "maxSeconds": settings.NOX_VOICE_MAX_S}
        monkeypatch.setattr(settings, "NOX_AI_BACKEND", "local")
        assert (await c.get("/api/v1/voice/status")).json()["speak"] is False
        assert (await c.post("/api/v1/voice/transcribe", files={"audio": ("a.webm", WEBM, "audio/webm")})).status_code == 409


async def test_transcribe_needs_sign_in_and_checks_the_file(db_clean):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as anon:
        assert (await anon.post("/api/v1/voice/transcribe", files={"audio": ("a.webm", WEBM, "audio/webm")})).status_code == 401
    async with _client() as c:
        assert (await c.post("/api/v1/voice/transcribe", files={"audio": ("a.txt", b"hello", "text/plain")})).status_code == 415
        big = b"\x00" * (8 * 1024 * 1024 + 10)
        assert (await c.post("/api/v1/voice/transcribe", files={"audio": ("a.webm", big, "audio/webm")})).status_code == 413
        assert (await c.post("/api/v1/voice/transcribe", files={"audio": ("a.webm", b"\x00" * 10, "audio/webm")})).status_code == 400


async def test_transcribe_streams_words_with_a_vocabulary_from_visible_apps(db_clean, monkeypatch):
    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import KnowledgeBase, Org

    await _setup_app()  # org "apex" with refunds-service; the lead is a member
    async with AsyncSessionLocal() as db:  # an org the lead isn't in
        hidden = Org(name="Hidden Co", slug="hidden")
        db.add(hidden)
        await db.flush()
        db.add(KnowledgeBase(org_id=hidden.id, app_name="secret-ledger", source_urls=[]))
        await db.commit()
    fake = use_fake(monkeypatch, FakeLlm(script=[text("Refund refunds-service orders older than 30 days.")]))
    async with _client("engineering", email="lead@example.com") as c:
        res = await c.post("/api/v1/voice/transcribe", files={"audio": ("talk.webm", WEBM, "audio/webm;codecs=opus")})
    assert res.status_code == 200
    events = _sse(res.text)
    assert [e for e, _ in events][-1] == "done"
    assert "".join(d["text"] for e, d in events if e == "delta") == "Refund refunds-service orders older than 30 days."
    assert events[-1][1] == {"type": "done", "text": "Refund refunds-service orders older than 30 days.", "language": None, "english": None}
    prompt = request_text(fake.requests[0])
    assert "refunds-service" in prompt and "secret-ledger" not in prompt  # scope is set by NoX, from memberships
    parts = fake.requests[0].contents[0].parts
    assert any(p.inline_data and p.inline_data.mime_type == "audio/webm" for p in parts)


async def test_transcribe_is_rate_limited(db_clean, monkeypatch):
    monkeypatch.setattr(settings, "NOX_VOICE_PER_HOUR", 1)
    use_fake(monkeypatch, FakeLlm(responder=lambda req: text("hello there")))
    async with _client() as c:
        assert (await c.post("/api/v1/voice/transcribe", files={"audio": ("a.webm", WEBM, "audio/webm")})).status_code == 200
        assert (await c.post("/api/v1/voice/transcribe", files={"audio": ("a.webm", WEBM, "audio/webm")})).status_code == 429


async def test_listen_speaks_once_then_plays_from_the_cache(db_clean, monkeypatch, tmp_path):
    from nox_api.services import media_storage

    calls = []

    async def fake_synthesize(t: str):
        calls.append(t)
        return b"RIFF" + b"\x00" * 100, "audio/wav"

    monkeypatch.setattr(speech, "synthesize", fake_synthesize)
    monkeypatch.setattr(media_storage, "speech_uri", lambda key: f"local://{tmp_path / key}.wav")
    words = f"Both callers keep working. {uuid.uuid4().hex}"
    async with _client() as c:
        first = await c.post("/api/v1/voice/speak", json={"text": f"**{words}**"})
        again = await c.post("/api/v1/voice/speak", json={"text": f"**{words}**"})
        assert first.status_code == again.status_code == 200
        assert first.headers["content-type"] == "audio/wav" and first.content.startswith(b"RIFF")
        assert (first.headers["x-nox-cache"], again.headers["x-nox-cache"]) == ("miss", "hit")
        assert calls == [words]
        assert (await c.post("/api/v1/voice/speak", json={"text": "```\nonly code\n```"})).status_code == 400
        monkeypatch.setattr(settings, "NOX_MODEL_TTS", "")
        assert (await c.post("/api/v1/voice/speak", json={"text": "hi"})).status_code == 409
