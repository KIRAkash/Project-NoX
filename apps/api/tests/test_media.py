"""Show NoX: captures upload, get watched and grounded, stay in scope, and feed drafting without code for business."""

import asyncio
import uuid
from types import SimpleNamespace

import httpx
import pytest

from nox_api.ai.schemas import MediaGrounding
from nox_api.services.local_storage import clear_kb_checkpoints, save_checkpoint_json, upload_content

from .ai_fakes import OBSERVATION, FakeLlm, calls, data, grounding, request_text, seat_views, text, use_fake
from .test_ai_search import PAGES
from .test_missions import _client

APP = "refunds-service"
CORPUS = ("=== SOURCE: https://github.com/apex/refunds-service ===\n--- FILE: src/refund.py ---\n"
          "class Refund:\n    def status(self):\n        return 'PENDING_SETTLEMENT'  # until the ledger entry lands\n")
VIDEO = b"\x1aE\xdf\xa3" + b"0" * 4096
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


def _answered(req) -> bool:
    last = (req.contents or [])[-1]
    return any(p.function_response for p in last.parts or [])


def _last_user_text(req) -> str:
    for c in reversed(req.contents or []):
        for p in c.parts or []:
            if p.text and c.role == "user":
                return p.text
    return ""


@pytest.fixture
def media_llm(monkeypatch):
    """One scripted model for every Show NoX agent (and the co-writer), told apart by their instructions."""
    script = {"ground_calls": [("grep_source", {"pattern": "PENDING_SETTLEMENT", "app": APP}),
                               ("read_kb_page", {"ref": f"{APP}/entities/refund"})],
              "grounding": grounding(APP)}

    def respond(req):
        sys = str(req.config.system_instruction or "")
        if "NoX's eyes" in sys:
            return data(OBSERVATION)
        if "Rewrite one capture" in sys:
            return data(seat_views())
        if "Someone is verifying" in sys:
            return data({"summary": "Fixed.", "hints": [{"index": 0, "hint": "Seen at 0:18: it works", "t": 18, "seen": True},
                                                        {"index": 9, "hint": "out of range"}]})
        if "Tie it to" in sys:
            return data(script["grounding"]) if _answered(req) else calls(*script["ground_calls"])
        asked = _last_user_text(req)
        if "The author now says" in asked:  # co-writer chat
            if _answered(req):
                return text("Added the repro from your recording.")
            return calls(("insert_section", {"heading": "Repro", "markdown": "- Status stays pending [[media:x#t=42]]"}))
        return text("ok")

    fake = use_fake(monkeypatch, FakeLlm(responder=respond))
    return SimpleNamespace(requests=fake.requests, script=script)  # tests adjust the grounding step through `script`


@pytest.fixture
async def kb(db_clean, monkeypatch):
    from nox_api.services import search
    from tests.test_missions import _setup_app

    monkeypatch.setattr(search, "embeddings_on", lambda: False)
    kb = await _setup_app()
    save_checkpoint_json(kb, "compiled_files.json", PAGES)
    upload_content(kb, "raw_ingest.txt", CORPUS)
    yield kb
    clear_kb_checkpoints(kb)


@pytest.fixture
def events(monkeypatch):
    """Every live event broadcast, in order."""
    from nox_api.services.sse import get_sse_manager

    seen: list[tuple[str, dict]] = []

    async def broadcast(key, event):
        seen.append((key, event))

    monkeypatch.setattr(get_sse_manager(), "broadcast", broadcast)
    return seen


async def _capture(c: httpx.AsyncClient, kind="screen_recording", mime="video/webm", body=VIDEO, **extra) -> str:
    r = await c.post("/api/v1/media", json={"kind": kind, "mime": mime, "bytes": len(body), "durationS": 45, **extra})
    assert r.status_code == 200, r.text
    up = r.json()
    assert up["method"] == "PUT" and up["uploadUrl"] == f"/api/v1/media/{up['id']}/content"
    assert (await c.put(up["uploadUrl"], content=body, headers=up["headers"])).status_code == 204
    done = await c.post(f"/api/v1/media/{up['id']}/complete")
    assert done.status_code == 202, done.text
    return up["id"]


async def _teammate(role: str, email: str) -> httpx.AsyncClient:
    """Someone else in the same org, in `role`."""
    async with _client("engineering") as lead:
        org = (await lead.get("/api/v1/me")).json()["orgs"][0]["id"]
        await lead.post(f"/api/v1/orgs/{org}/members", json={"email": email})
    return _client(role, email)


async def _settled(c: httpx.AsyncClient, media_id: str) -> dict:
    for _ in range(200):
        m = (await c.get(f"/api/v1/media/{media_id}")).json()
        if m["status"] not in ("uploading", "analyzing"):
            return m
        await asyncio.sleep(0.05)
    raise AssertionError("analysis never finished")


async def test_capture_is_watched_grounded_and_pitched_per_seat(kb, media_llm, events):
    async with _client("business") as biz:
        mid = await _capture(biz, caption="Why is this still pending?")
        m = await _settled(biz, mid)
    assert m["status"] == "ready" and m["label"] == "0:45 screen recording"
    assert m["summary"] == "Customers see pending."          # the business seat's rewrite
    assert m["code"] == [] and m["contracts"] == [] and m["explanation"] is None  # no code for business
    assert m["findings"] == [] or all(f["ref"].startswith(APP) for f in m["findings"])
    assert m["suggestedRequest"].startswith("Show a partly filled trade") and m["apps"][0]["app"] == APP
    assert m["problemTimes"] == [42.0] and "calls" in m["usage"]

    types = [e["type"] for k, e in events if k == f"media:{mid}"]
    assert types[0] == "media.analyzing" and types[-1] == "media.ready"
    steps = [e["payload"]["label"] for k, e in events if k == f"media:{mid}" and e["type"] == "media.step"]
    assert steps[0] == "Watching the recording" and "Reading the screen at 0:42" in steps
    assert "Checking what NoX Shield allows" in steps and steps[-1] == "Done"
    assert f"Checking {APP} for “PENDING_SETTLEMENT”" in steps and not any(s.startswith("Found") for s in steps)

    # the model saw the recording as a part, and Perceive was asked for the caption
    perceive = next(r for r in media_llm.requests if "NoX's eyes" in str(r.config.system_instruction))
    assert any(p.inline_data and p.inline_data.mime_type == "video/webm" for p in perceive.contents[-1].parts)
    assert perceive.contents[-1].parts[-1].video_metadata.fps == 1
    assert "Why is this still pending?" in request_text(perceive)

    async with _client("business") as biz:
        vtt = (await biz.get(f"/api/v1/media/{mid}/captions.vtt")).text
    assert vtt.startswith("WEBVTT") and "00:00:02.000 --> 00:00:40.000" in vtt
    assert "[EMAIL_ADDRESS]" in vtt and "jo@apex.example" not in vtt  # personal data is redacted before anyone sees it


async def test_developer_sees_code_locations_and_found_steps(kb, media_llm, events):
    async with _client("developer") as dev:
        mid = await _capture(dev)
        m = await _settled(dev, mid)
    assert [c["location"] for c in m["code"]] == ["src/refund.py:3"]
    assert m["contracts"][0]["identifier"] == "order.refunded" and m["explanation"]
    steps = [e["payload"]["label"] for k, e in events if k == f"media:{mid}" and e["type"] == "media.step"]
    assert "Found `refund.py:3`" in steps


async def test_limits_and_types(kb):
    async with _client("business") as biz:
        big = await biz.post("/api/v1/media", json={"kind": "image", "mime": "image/png", "bytes": 11 * 1024 * 1024})
        assert big.status_code == 413
        long = await biz.post("/api/v1/media", json={"kind": "audio", "mime": "audio/webm", "bytes": 100, "durationS": 900})
        assert long.status_code == 413
        assert (await biz.post("/api/v1/media", json={"kind": "image", "mime": "text/html", "bytes": 10})).status_code == 415
        assert (await biz.post("/api/v1/media", json={"kind": "video", "mime": "image/png", "bytes": 10})).status_code == 415
        # an upload that doesn't match the declared size isn't accepted
        r = (await biz.post("/api/v1/media", json={"kind": "image", "mime": "image/png", "bytes": 10})).json()
        assert (await biz.put(r["uploadUrl"], content=b"0" * 20, headers={"Content-Type": "image/png"})).status_code == 413
        assert (await biz.post(f"/api/v1/media/{r['id']}/complete")).status_code == 409


async def test_drafts_are_private_and_missions_stay_in_their_org(kb, media_llm, fake_nox):
    async with _client("business") as biz:
        draft = await _capture(biz)
        await _settled(biz, draft)
        key = (await biz.post("/api/v1/missions", json={"prompt": "Trades stay pending after partial fills", "appIds": [kb]})).json()["key"]
        attached = await _capture(biz, missionKey=key, role="business")
        await _settled(biz, attached)
        url = (await biz.get(f"/api/v1/media/{attached}/url")).json()["url"]

    # someone else in the same org: can't see the draft, can see the mission's capture
    async with await _teammate("product", "po@example.com") as po:
        assert (await po.get(f"/api/v1/media/{draft}")).status_code == 404
        assert (await po.get(f"/api/v1/media/{draft}/content")).status_code == 404
        assert (await po.delete(f"/api/v1/media/{draft}")).status_code == 404
        assert (await po.get(f"/api/v1/media/{attached}")).status_code == 200
        assert (await po.delete(f"/api/v1/media/{attached}")).status_code == 403  # not theirs, and not their file
        assert [x["id"] for x in (await po.get(f"/api/v1/missions/{key}/media")).json()] == [attached]

    # another org: nothing at all
    async with _client("business", "outsider@example.com") as out:
        assert (await out.get(f"/api/v1/media/{attached}")).status_code == 404
        assert (await out.get(f"/api/v1/media/{attached}/url")).status_code == 404
        assert (await out.get(f"/api/v1/media/{attached}/content")).status_code == 404
        assert (await out.delete(f"/api/v1/media/{attached}")).status_code == 404
        assert (await out.get(f"/api/v1/missions/{key}/media")).status_code == 404

    from nox_api.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as anon:
        assert (await anon.get(f"/api/v1/media/{attached}/content")).status_code == 401  # no token, no sign-in
        assert (await anon.get(f"/api/v1/media/{attached}/content?exp=9999999999&sig=forged")).status_code == 401
        got = await anon.get(url)  # the short-lived URL the player gets
        assert got.status_code == 200 and got.content == VIDEO

    async with _client("business") as biz:  # the uploader deletes it
        assert (await biz.delete(f"/api/v1/media/{attached}")).status_code == 204
        assert (await biz.get(f"/api/v1/media/{attached}")).status_code == 404
        types = [e["type"] for e in (await biz.get(f"/api/v1/missions/{key}/events")).json()]
        assert "media.attached" in types and "media.analyzed" in types and "media.deleted" in types


async def test_business_cant_compare_evidence_on_the_developers_file(kb, media_llm, fake_nox):
    async with _client("developer") as dev:
        key = (await dev.post("/api/v1/missions", json={"prompt": "Trades stay pending after partial fills", "appIds": [kb]})).json()["key"]
        mid = await _capture(dev, missionKey=key)
    async with _client("business") as biz:
        r = await biz.post(f"/api/v1/missions/{key}/files/developer/verify-evidence", json={"mediaIds": [mid]})
        assert r.status_code == 403


async def test_show_it_works_writes_hints_but_never_ticks(kb, media_llm, fake_nox):
    async with _client("developer") as dev:
        key = (await dev.post("/api/v1/missions", json={"prompt": "Trades stay pending after partial fills", "appIds": [kb]})).json()["key"]
        from tests.test_missions import _wait_drafts

        await _wait_drafts(dev, key)
        before = await _capture(dev, missionKey=key)
        await _settled(dev, before)
        await dev.post(f"/api/v1/missions/{key}/proceed")
        for role in ("business", "product", "engineering"):
            async with _client(role) as c:
                await c.post(f"/api/v1/missions/{key}/files/{role}/approve")
        await dev.post(f"/api/v1/missions/{key}/files/developer/approve")
        assert (await dev.post(f"/api/v1/missions/{key}/complete")).status_code == 200
        after = await _capture(dev, missionKey=key)
        r = await dev.post(f"/api/v1/missions/{key}/files/developer/verify-evidence", json={"mediaIds": [after]})
        assert r.status_code == 202
        for _ in range(200):
            m = (await dev.get(f"/api/v1/missions/{key}")).json()
            v = next(f for f in m["files"] if f["role"] == "developer")["verification"]
            if v.get("hints"):
                break
            await asyncio.sleep(0.05)
        assert v["hints"] == [{"index": 0, "hint": "Seen at 0:18: it works", "t": 18.0, "seen": True}]
        assert v["evidence"]["before"] == [before] and v["evidence"]["after"] == [after]
        assert not any(i["checked"] for i in v["items"])  # NoX never ticks


async def test_grounding_cant_reach_another_orgs_app(kb, media_llm):
    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import KnowledgeBase, MediaAsset

    async with _client("engineering", "boss@other.example") as other:
        org_b = (await other.post("/api/v1/orgs", json={"name": "Other", "slug": "other"})).json()
    async with AsyncSessionLocal() as db:
        payroll = KnowledgeBase(org_id=uuid.UUID(org_b["id"]), app_name="payroll", source_urls=[])
        db.add(payroll)
        await db.commit()
        save_checkpoint_json(str(payroll.id), "compiled_files.json", {"secrets.md": "# Salaries"})
        upload_content(str(payroll.id), "raw_ingest.txt", "=== SOURCE: x ===\n--- FILE: pay.py ---\nSALARY = 1\n")

    media_llm.script["ground_calls"] = [("grep_source", {"pattern": "SALARY", "app": "payroll"}),
                                              ("read_kb_page", {"ref": "payroll/secrets"}),
                                              ("search_kb", {"query": "salary", "everywhere": True})]
    media_llm.script["grounding"] = grounding("payroll", ref="secrets", code="pay.py:1")
    async with _client("business") as biz:
        mid = await _capture(biz)
        m = await _settled(biz, mid)
    assert m["status"] == "ready" and m["apps"] == [] and m["findings"] == []
    async with AsyncSessionLocal() as db:
        stored = (await db.get(MediaAsset, uuid.UUID(mid))).grounding
    assert stored["findings"] == [] and stored["code"] == [] and stored["contracts"] == [] and stored["apps"] == []
    ground = [r for r in media_llm.requests if "Tie it to" in str(r.config.system_instruction)]
    assert "Unknown application 'payroll'" in request_text(ground[-1])
    assert "payroll" not in str(ground[0].config.system_instruction)  # the scope NoX set never listed it
    clear_kb_checkpoints(str(payroll.id))


def test_post_check_drops_what_wasnt_looked_up(kb):
    from nox_api.missions.media import post_check

    g = MediaGrounding.model_validate(grounding(APP) | {
        "findings": [{"ref": f"kb:{APP}/entities/refund.md", "says": "a", "relevance": "b"},
                     {"ref": f"{APP}/concepts/made-up", "says": "c", "relevance": "d"}],
        "code": [{"app": APP, "location": "src/refund.py:3"}, {"app": APP, "location": "src/ghost.py:9"},
                 {"app": "payroll", "location": "pay.py:1"}],
    })
    out = post_check(g, [f"{APP}/entities/refund"], {APP: kb})
    assert [f.ref for f in out.findings] == [f"{APP}/entities/refund"]
    assert [c.location for c in out.code] == ["src/refund.py:3"]


async def test_shield_withholds_a_capture_from_every_prompt(kb, media_llm, fake_nox, monkeypatch):
    from nox_api.core.config import settings
    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import Mission
    from nox_api.missions.media import mission_evidence
    from nox_api.services import shield

    monkeypatch.setattr(settings, "NOX_SHIELD", "enforce")

    async def blocked(name, text, **kw):
        assert "T-4471" in text  # transcript and on-screen text are what's screened
        return shield.Verdict(blocked=True, screened=True, findings=[shield.Finding(category="PROMPT_INJECTION")])

    monkeypatch.setattr(shield, "screen_source", blocked)
    async with _client("business") as biz:
        draft = await _capture(biz)
        m = await _settled(biz, draft)
        assert m["status"] == "withheld" and "prompt injection" in m["statusReason"]
        r = await biz.post("/api/v1/missions", json={"prompt": "Trades stay pending after partial fills", "appIds": [kb], "mediaIds": [draft]})
        assert r.status_code == 422
        key = (await biz.post("/api/v1/missions", json={"prompt": "Trades stay pending after partial fills", "appIds": [kb]})).json()["key"]
        onmission = await _capture(biz, missionKey=key)
        assert (await _settled(biz, onmission))["status"] == "withheld"
        assert (await biz.get(f"/api/v1/missions/{key}/media")).json()[0]["status"] == "withheld"  # the uploader sees why
    async with await _teammate("product", "po@example.com") as po:
        assert (await po.get(f"/api/v1/missions/{key}/media")).json() == []
        assert (await po.get(f"/api/v1/media/{onmission}")).status_code == 404
    async with AsyncSessionLocal() as db:
        mission = (await db.execute(__import__("sqlalchemy").select(Mission))).scalars().first()
        assert await mission_evidence(db, mission.id) == []


def _evidence():
    from nox_api.missions.media import MediaEvidence

    g = grounding(APP)
    return [MediaEvidence(id="abc", label="0:45 screen recording", caption=None, observation=OBSERVATION, grounding=g)]


@pytest.mark.parametrize("role,code", [("business", False), ("product", False), ("engineering", True), ("developer", True)])
def test_build_prompt_keeps_code_out_of_business_and_product(role, code):
    from nox_api.db.models import Mission, Role
    from nox_api.missions.drafting import build_prompt

    mission = Mission(number=7, title="Pending trades", prompt="Trades stay pending", created_as_role=Role.business)
    p = build_prompt(mission, Role(role), {}, "(kb)", evidence=_evidence())
    assert "What the author showed (capture abc, 0:45 screen recording)" in p
    assert "0:42 Status stays Pending settlement after a partial fill (problem)" in p
    assert f"[[kb:{APP}/entities/refund]]" in p and "[[media:abc#t=<seconds>]]" in p
    assert ("src/refund.py:3" in p) is code and ("order.refunded" in p) is code


async def test_launching_a_mission_attaches_drafts_and_moves_them_to_its_org(kb, media_llm, fake_nox):
    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import KnowledgeBase, MediaAsset

    async with _client("business") as biz:
        root = (await biz.get("/api/v1/me")).json()["orgs"][0]["id"]
    async with _client("engineering") as lead:
        team = (await lead.post("/api/v1/orgs", json={"name": "Settlement", "slug": "settlement", "parentOrgId": root})).json()
    async with AsyncSessionLocal() as db:
        app = KnowledgeBase(org_id=uuid.UUID(team["id"]), app_name="trade-settlement-system", source_urls=[])
        db.add(app)
        await db.commit()
        app_id = str(app.id)
    async with _client("business") as biz:
        mid = await _capture(biz)
        await _settled(biz, mid)
        m = (await biz.post("/api/v1/missions", json={"prompt": "Trades stay pending after partial fills", "appIds": [app_id], "mediaIds": [mid]})).json()
        got = (await biz.get(f"/api/v1/media/{mid}")).json()
        assert got["missionKey"] == m["key"]
        types = [e["type"] for e in (await biz.get(f"/api/v1/missions/{m['key']}/events")).json()]
        assert "media.attached" in types
    async with AsyncSessionLocal() as db:
        assert str((await db.get(MediaAsset, uuid.UUID(mid))).org_id) == team["id"]
    async with _client("business", "lead@example.com") as same, _client("product", "po2@example.com") as other:
        # attaching it again, or someone else's draft, is a 404
        r = await same.post("/api/v1/missions", json={"prompt": "Trades stay pending again", "appIds": [kb], "mediaIds": [mid]})
        assert r.status_code == 404
        r = await other.post("/api/v1/missions", json={"prompt": "Trades stay pending again", "appIds": [kb], "mediaIds": [str(uuid.uuid4())]})
        assert r.status_code == 404


async def test_drafting_sees_the_capture(kb, media_llm, monkeypatch):
    """Launch with a capture: every drafted file's prompt carries it, and the business one has no code."""
    from nox_api.missions import drafting

    prompts: dict[str, str] = {}

    async def spy(mission, role, upstream, context, current=None, instruction=None, apps=None, evidence=None):
        prompts[role.value] = drafting.build_prompt(mission, role, upstream, context, evidence=evidence)
        return f"# {role.value}\n\n## Verification checklist\n- [ ] it works\n"

    monkeypatch.setattr(drafting, "generate_file", spy)
    async with _client("developer") as dev:
        mid = await _capture(dev)
        await _settled(dev, mid)
        key = (await dev.post("/api/v1/missions", json={"prompt": "Trades stay pending after partial fills", "appIds": [kb], "mediaIds": [mid]})).json()["key"]
        from tests.test_missions import _wait_drafts

        await _wait_drafts(dev, key)
    assert set(prompts) == {"business", "product", "engineering", "developer"}
    assert all(f"capture {mid}" in p for p in prompts.values())
    assert "src/refund.py:3" not in prompts["business"] and "src/refund.py:3" in prompts["developer"]


async def test_chat_with_a_capture_edits_with_evidence_and_can_be_reverted(kb, media_llm, fake_nox):
    async with _client("developer") as dev:
        key = (await dev.post("/api/v1/missions", json={"prompt": "Trades stay pending after partial fills", "appIds": [kb]})).json()["key"]
        from tests.test_missions import _wait_drafts

        m = await _wait_drafts(dev, key)
        v0 = next(f for f in m["files"] if f["role"] == "developer")["version"]
        mid = await _capture(dev, missionKey=key, role="developer")
        # attached while NoX is still watching: the turn waits for it
        r = await dev.post(f"/api/v1/missions/{key}/files/developer/chat", json={"message": "This is what I mean", "mediaIds": [mid]})
        assert r.status_code == 202 and r.json()["mediaIds"] == [mid]
        for _ in range(200):
            msgs = (await dev.get(f"/api/v1/missions/{key}/files/developer/chat")).json()
            if any(x["author"] == "nox" for x in msgs):
                break
            await asyncio.sleep(0.05)
        assert msgs[-1]["body"] == "Added the repro from your recording."
        turn = next(r for r in media_llm.requests if "The author now says" in _last_user_text(r))
        assert f"capture {mid}, 0:45 screen recording, attached to this message" in _last_user_text(turn)
        f = next(x for x in (await dev.get(f"/api/v1/missions/{key}")).json()["files"] if x["role"] == "developer")
        assert "## Repro" in f["markdown"]
        undone = (await dev.post(f"/api/v1/missions/{key}/files/developer/revert", json={"toVersion": v0})).json()
        assert "## Repro" not in undone["markdown"]
        # a capture from another mission can't ride along
        other = (await dev.post("/api/v1/missions", json={"prompt": "Another change for the refunds", "appIds": [kb]})).json()["key"]
        r = await dev.post(f"/api/v1/missions/{other}/files/developer/chat", json={"message": "hi", "mediaIds": [mid]})
        assert r.status_code == 404


async def test_local_backend_reads_images_but_not_video(kb, media_llm, monkeypatch):
    from nox_api.core.config import settings

    monkeypatch.setattr(settings, "NOX_AI_BACKEND", "local")
    async with _client("business") as biz:
        r = await biz.post("/api/v1/media", json={"kind": "screen_recording", "mime": "video/webm", "bytes": 100})
        assert r.status_code == 415 and "cloud" in r.json()["detail"]
        assert (await biz.get("/api/v1/me")).json()["aiBackend"] == "local"
        mid = await _capture(biz, kind="screenshot", mime="image/png", body=PNG)
        assert (await _settled(biz, mid))["status"] == "ready"


async def test_annotated_screenshot_sends_both_images(kb, media_llm):
    async with _client("business") as biz:
        original = await _capture(biz, kind="screenshot", mime="image/png", body=PNG)
        await _settled(biz, original)
        marked = await _capture(biz, kind="screenshot", mime="image/png", body=PNG + b"marked", annotatedOf=original)
        await _settled(biz, marked)
    perceive = [r for r in media_llm.requests if "NoX's eyes" in str(r.config.system_instruction)][-1]
    assert sum(1 for p in perceive.contents[-1].parts if p.inline_data) == 2
    assert "marked the area of interest in colour" in str(perceive.config.system_instruction)
