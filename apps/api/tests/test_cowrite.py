import asyncio

import httpx
import pytest

from nox_api.missions.cowrite import line_ops
from tests.test_missions import _client, _setup_app, _wait_drafts


def test_line_ops_describe_the_edit():
    ops = line_ops("# T\na\nb\nc\n", "# T\na\nB!\nc\nd\n")
    assert ops == [{"op": "replace", "from": 2, "to": 3, "lines": ["B!"]}, {"op": "insert", "from": 4, "to": 4, "lines": ["d"]}]


def _last_user_text(req) -> str:
    for c in reversed(req.contents or []):
        for p in c.parts or []:
            if p.text and c.role == "user":
                return p.text
    return ""


def _answered(req) -> bool:
    """Has the model already made its tool call this turn (i.e. the last content is a tool result)?"""
    last = (req.contents or [])[-1]
    return any(p.function_response for p in last.parts or [])


@pytest.fixture
def fake_llm(monkeypatch):
    """NoX's co-writer on a scripted model: edits through the section tools, then replies."""
    from .ai_fakes import FakeLlm, call, text, use_fake

    def respond(req):
        asked = _last_user_text(req).lower()
        if "add a rollback" in asked:
            return text("Added a rollback section.") if _answered(req) else call("insert_section", heading="Rollback", markdown="- flag off")
        if "the author now says" in asked:  # a question: answer, no edit
            return text("It uses src/auth.py.")
        if _answered(req):  # refine
            return text("Added detail from the KB.")
        return call("insert_section", heading="Details", markdown="More detail from the KB.")

    return use_fake(monkeypatch, FakeLlm(responder=respond))


async def _events(c, key, type_):
    return [e for e in (await c.get(f"/api/v1/missions/{key}/events")).json() if e["type"] == type_]


async def _until(pred, tries=100):
    for _ in range(tries):
        if await pred():
            return
        await asyncio.sleep(0.05)
    raise AssertionError("condition never met")


async def test_refine_then_undo(db_clean, fake_nox, fake_llm):
    kb = await _setup_app()
    async with _client("developer") as dev:
        key = (await dev.post("/api/v1/missions", json={"prompt": "Lock accounts after failed logins", "appIds": [kb]})).json()["key"]
        m = await _wait_drafts(dev, key)
        v0 = next(f for f in m["files"] if f["role"] == "developer")["version"]
        assert (await dev.post(f"/api/v1/missions/{key}/files/developer/refine", json={})).status_code == 202

        async def refined():
            return bool(await _events(dev, key, "nox.edit"))

        await _until(refined)
        edit = (await _events(dev, key, "nox.edit"))[0]["payload"]
        assert edit["fromVersion"] == v0 and edit["toVersion"] == v0 + 1 and edit["ops"]
        m = (await dev.get(f"/api/v1/missions/{key}")).json()
        assert "More detail from the KB" in next(f for f in m["files"] if f["role"] == "developer")["markdown"]
        undone = (await dev.post(f"/api/v1/missions/{key}/files/developer/revert", json={"toVersion": v0})).json()
        assert undone["version"] == v0 + 2 and "More detail" not in undone["markdown"]


async def test_chat_edits_only_when_asked(db_clean, fake_nox, fake_llm):
    kb = await _setup_app()
    async with _client("developer") as dev:
        key = (await dev.post("/api/v1/missions", json={"prompt": "Lock accounts after failed logins", "appIds": [kb]})).json()["key"]
        await _wait_drafts(dev, key)

        async def replies(n):
            async def check():
                return len([m for m in (await dev.get(f"/api/v1/missions/{key}/files/developer/chat")).json() if m["author"] == "nox"]) >= n
            return check

        await dev.post(f"/api/v1/missions/{key}/files/developer/chat", json={"message": "Which file handles login?"})
        await _until(await replies(1))
        assert not await _events(dev, key, "nox.edit")
        await dev.post(f"/api/v1/missions/{key}/files/developer/chat", json={"message": "Add a rollback section please"})
        await _until(await replies(2))
        msgs = (await dev.get(f"/api/v1/missions/{key}/files/developer/chat")).json()
        assert [m["author"] for m in msgs] == ["user", "nox", "user", "nox"] and msgs[-1]["body"] == "Added a rollback section."
        m = (await dev.get(f"/api/v1/missions/{key}")).json()
        assert "## Rollback" in next(f for f in m["files"] if f["role"] == "developer")["markdown"]


async def test_chat_is_locked_to_the_files_role(db_clean, fake_nox, fake_llm):
    kb = await _setup_app()
    async with _client("developer") as dev:
        key = (await dev.post("/api/v1/missions", json={"prompt": "Lock accounts after failed logins", "appIds": [kb]})).json()["key"]
    async with _client("business") as biz:
        assert (await biz.post(f"/api/v1/missions/{key}/files/developer/chat", json={"message": "hi"})).status_code == 403
        assert (await biz.post(f"/api/v1/missions/{key}/files/developer/refine", json={})).status_code == 403


async def test_image_upload_and_capability_url(db_clean, fake_nox):
    kb = await _setup_app()
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 64
    async with _client("developer") as dev:
        key = (await dev.post("/api/v1/missions", json={"prompt": "Lock accounts after failed logins", "appIds": [kb]})).json()["key"]
        res = (await dev.post(f"/api/v1/missions/{key}/assets", files={"file": ("diagram.png", png, "image/png")})).json()
        assert res["markdown"].startswith("![diagram](/api/v1/missions/assets/")
        assert (await dev.post(f"/api/v1/missions/{key}/assets", files={"file": ("x.html", b"<script>", "text/html")})).status_code == 415
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=__import__("nox_api.main").main.app), base_url="http://test") as anon:
        got = await anon.get(res["url"])
        assert got.status_code == 200 and got.content == png
        assert (await anon.get("/api/v1/missions/assets/../../etc/passwd")).status_code == 404
        assert (await anon.get("/api/v1/missions/assets/" + "0" * 32 + ".png")).status_code == 404


def test_lost_headings_detects_dropped_author_sections():
    from nox_api.missions.cowrite import lost_headings

    old = "# Build spec: X\n\n## Tasks\n- a\n\n## Rollout\n- flag\n\n## Open questions\n- restart?\n"
    assert lost_headings(old, "# Build spec: X\n\n## Tasks\n- a\n- b\n") == {"rollout"}  # answered open questions may go
    assert lost_headings(old, old + "\n## Risks\n- r\n") == set()
    assert lost_headings(old, old.replace("# Build spec: X", "# Build spec: Y")) == set()  # retitling is fine
