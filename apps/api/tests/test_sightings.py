"""Sightings: grounded suggestions per seat, filtered per seat, deduped, scheduled, and one click from a mission."""

import asyncio
import json
import uuid
from datetime import datetime

import pytest

from nox_api.ai.schemas import SightingCandidate, SightingEvidence
from nox_api.db.models import Role
from nox_api.missions import lenses, sightings
from nox_api.services.local_storage import clear_kb_checkpoints, save_checkpoint_json, upload_content

from .ai_fakes import FakeLlm, calls, data, use_fake
from .test_ai_search import PAGES
from .test_missions import _client, _setup_app, _wait_drafts

APP = "refunds-service"
CORPUS = ("=== SOURCE: https://github.com/apex/refunds-service ===\n--- FILE: src/refund.py ---\n"
          "class Refund:\n    def status(self):\n        return 'PENDING_SETTLEMENT'  # until the ledger entry lands\n")
WAIT = "Customers wait days for refunds because the refund status stays pending until the ledger entry is written"
HARDCODE = "Refund.status hardcodes PENDING_SETTLEMENT instead of reading the ledger entry, so every caller polls it"


# ── Pure parts ───────────────────────────────────────────────────────────────


def test_reader_lint_keeps_code_out_of_business_and_product_views():
    assert lenses.lint_view(Role.business, "The refund endpoint is slow") == ["technical word: 'endpoint'"]
    assert lenses.lint_view(Role.product, "Change `Refund.status` in src/refund.py")
    assert lenses.lint_view(Role.business, "Customers wait three days for their money back") == []
    assert lenses.lint_view(Role.developer, "Change `Refund.status` in src/refund.py:3") == []


def test_open_questions_reach_only_readers_they_are_written_for():
    from nox_api.db.models import Sighting

    s = Sighting(open_questions=["Which ORM should store users?", "Should verify_token raise HTTPException?"],
                 views={"business": {"questions": ["Should staff get their own sign-in?", "Do we need a new ORM?"]},
                        "product": {"questions": ["Should a locked account show a reason?"]}})
    assert sightings.questions_for(s, Role.business) == ["Should staff get their own sign-in?"]  # the lint still applies
    assert sightings.questions_for(s, Role.product) == ["Should a locked account show a reason?"]
    assert sightings.questions_for(s, Role.developer) == s.open_questions
    assert sightings.questions_for(s, Role.engineering) == s.open_questions


def test_lens_brief_puts_the_focus_first():
    brief = lenses.lens_brief(Role.engineering, focus=["cost"])
    assert brief.index("- cost:") < brief.index("- architecture:") and "current focus" in brief


def test_next_run_follows_cadence_day_hour_and_timezone():
    monday_9 = datetime(2026, 10, 5, 9, 0)  # a Monday, UTC
    assert sightings.next_run("weekly", 0, 8, "UTC", monday_9) == datetime(2026, 10, 12, 8, 0)
    assert sightings.next_run("weekly", 0, 10, "UTC", monday_9) == datetime(2026, 10, 5, 10, 0)
    assert sightings.next_run("daily", 0, 8, "UTC", monday_9) == datetime(2026, 10, 6, 8, 0)
    assert sightings.next_run("daily", 0, 8, "Asia/Kolkata", monday_9) == datetime(2026, 10, 6, 2, 30)
    assert sightings.next_run("off", 0, 8, "UTC", monday_9) is None
    assert sightings.next_run("weekly", 0, 8, "Not/AZone", monday_9) == datetime(2026, 10, 12, 8, 0)


def _cand(claim: str, *refs: tuple[str, str]) -> SightingCandidate:
    return SightingCandidate(claim=claim, kind="performance", apps=[APP],
                             evidence=[SightingEvidence(kind=k, ref=r, says="x") for k, r in refs])


def test_merge_joins_the_same_claim_seen_through_two_lenses():
    found = [(Role.business, _cand(WAIT, ("kb", "a/p1"))), (Role.product, _cand(WAIT + " today", ("kb", "a/p2"))),
             (Role.developer, _cand(HARDCODE, ("code", "src/refund.py:3")))]
    opps = sightings.merge(found, None)
    assert sorted(len(o.found) for o in opps) == [1, 2]
    joined = next(o for o in opps if len(o.found) == 2)
    assert joined.found_by == [Role.business, Role.product] and {e.ref for e in joined.evidence} == {"a/p1", "a/p2"}


def test_two_shared_sources_merge_even_when_the_words_differ():
    a = _cand("Cache the refund status", ("kb", "a/p1"), ("code", "src/refund.py:3"))
    b = _cand("Stop polling the ledger", ("kb", "a/p1"), ("code", "src/refund.py:3"))
    assert len(sightings.merge([(Role.developer, a), (Role.engineering, b)], None)) == 1


@pytest.fixture
def kb_files():
    kb = str(uuid.uuid4())
    save_checkpoint_json(kb, "compiled_files.json", PAGES)
    upload_content(kb, "raw_ingest.txt", CORPUS)
    yield kb
    clear_kb_checkpoints(kb)


def test_check_drops_unread_pages_and_code_for_seats_that_cant_see_it(kb_files):
    apps = {APP: kb_files}
    c = _cand(WAIT, ("kb", f"{APP}/entities/refund"), ("kb", f"{APP}/concepts/never-read"), ("code", "src/refund.py:3"),
              ("mission", "NOX-99"))
    kept = sightings.check_candidate(c, seat=Role.business, app=APP, apps=apps, cited=[f"{APP}/entities/refund"],
                                     jira_read=[], signals={})
    assert [(e.kind, e.ref) for e in kept.evidence] == [("kb", f"{APP}/entities/refund")]
    assert kept.kind in lenses.LENSES[Role.business].kinds  # an unknown kind falls back to the lens's first

    dev = _cand(HARDCODE, ("code", "src/refund.py:3"), ("code", "src/made_up.py:1"))
    kept = sightings.check_candidate(dev, seat=Role.developer, app=APP, apps=apps, cited=[], jira_read=[], signals={})
    assert [e.ref for e in kept.evidence] == ["src/refund.py:3"]
    assert sightings.check_candidate(_cand(WAIT, ("kb", f"{APP}/x")), seat=Role.product, app=APP, apps=apps, cited=[],
                                     jira_read=[], signals={}) is None


# ── A whole run against a scripted model ─────────────────────────────────────


def _answered(req) -> bool:
    return any(p.function_response for p in ((req.contents or [])[-1].parts or []))


def _user_text(req) -> str:
    for c in reversed(req.contents or []):
        for p in c.parts or []:
            if p.text and c.role == "user":
                return p.text
    return ""


def _view(title: str, why: str, request: str) -> dict:
    return {"title": title, "why": why, "impact": "Fewer customers chase their money.", "request": request,
            "how_we_know": ["Past changes to refunds were sent back twice."], "mission_type": "change"}


@pytest.fixture
def sighting_llm(monkeypatch):
    def respond(req):
        sys = str(req.config.system_instruction or "")
        if "You are NoX's scout for the" in sys:
            seat = sys.split("scout for the ", 1)[1].split(" seat", 1)[0]
            if seat in ("business user", "product owner"):
                if not _answered(req):
                    return calls(("read_kb_page", {"ref": f"{APP}/entities/refund"}))
                return data({"candidates": [{"claim": WAIT, "kind": "customer_experience", "apps": [APP], "impact": "high",
                                             "impact_basis": "Every refund waits on the ledger.",
                                             "evidence": [{"kind": "kb", "ref": f"{APP}/entities/refund", "says": "A refund waits for the ledger."},
                                                          {"kind": "kb", "ref": f"{APP}/concepts/unread", "says": "made up"},
                                                          {"kind": "code", "ref": "src/refund.py:3", "says": "hardcoded"}]}]})
            if seat == "developer":
                if not _answered(req):
                    return calls(("grep_source", {"pattern": "PENDING_SETTLEMENT", "app": APP}),
                                 ("read_kb_page", {"ref": f"{APP}/entities/refund"}))
                return data({"candidates": [{"claim": HARDCODE, "kind": "performance", "apps": [APP], "impact": "medium",
                                             "effort": "S", "evidence": [
                                                 {"kind": "code", "ref": "src/refund.py:3", "says": "The status is a constant."},
                                                 {"kind": "kb", "ref": f"{APP}/entities/refund", "says": "Status follows the ledger."}]}]})
            return data({"candidates": []})
        if "You are NoX's critic" in sys:
            items = json.loads(_user_text(req))
            out = []
            for it in items:
                code = "hardcodes" in it["claim"]
                rel = ({"business": 0.1, "product": 0.2, "engineering": 0.7, "developer": 0.9} if code
                       else {"business": 0.9, "product": 0.8, "engineering": 0.2, "developer": 0.3})
                out.append({"index": it["index"], "keep": True, "why": "Specific.", "claim": it["claim"],
                            "specific": 4, "actionable": 4, "evidenced": 4, "worth": 4, "relevance": rel})
            return data({"items": out})
        if "Write one suggested change" in sys:
            msg = json.loads(_user_text(req))
            views = {}
            for seat in msg["seats"]:
                if seat == "business":
                    views[seat] = _view("Refunds feel slow to customers", "The refund endpoint waits on the ledger.",
                                        "Show customers when their refund will arrive instead of a pending status.")
                elif seat == "developer":
                    views[seat] = _view("Compute refund status from the ledger", "`Refund.status` returns a constant (src/refund.py:3).",
                                        "Make Refund.status read the ledger entry and add a test for partial settlement.")
                else:
                    views[seat] = _view(f"{seat} view", "Plain words for this reader.", f"A {seat} request about refunds.")
            return data(views)
        if "Rewrite this suggested change" in sys:
            return data(_view("Refunds feel slow to customers", "Customers see pending for days while the money is on its way.",
                              "Show customers when their refund will arrive instead of a pending status."))
        raise AssertionError(f"unexpected agent: {sys[:80]}")

    return use_fake(monkeypatch, FakeLlm(responder=respond))


@pytest.fixture
async def apex(db_clean, monkeypatch):
    from nox_api.core.config import settings
    from nox_api.services import search
    from nox_api.services.sse import get_sse_manager

    monkeypatch.setattr(search, "embeddings_on", lambda: False)
    monkeypatch.setattr(settings, "WORKER_MODE", "in_process")
    seen: list = []

    async def broadcast(key, event):
        seen.append((key, event))

    monkeypatch.setattr(get_sse_manager(), "broadcast", broadcast)
    kb = await _setup_app()
    save_checkpoint_json(kb, "compiled_files.json", PAGES)
    upload_content(kb, "raw_ingest.txt", CORPUS)
    async with _client("engineering") as lead:
        org = (await lead.get("/api/v1/orgs")).json()[0]["id"]
    yield {"kb": kb, "org": org, "events": seen}
    clear_kb_checkpoints(kb)


async def _run(org: str, role: str = "engineering") -> dict:
    async with _client(role) as c:
        res = await c.post(f"/api/v1/orgs/{org}/sightings/run")
        assert res.status_code == 202, res.text
        run_id = res.json()["runId"]
        for _ in range(200):
            runs = (await c.get(f"/api/v1/orgs/{org}/sightings/runs")).json()
            run = next(r for r in runs if r["id"] == run_id)
            if run["status"] != "running":
                return run
            await asyncio.sleep(0.05)
    raise AssertionError("run never finished")


async def test_a_run_writes_each_seat_its_own_grounded_sighting(apex, sighting_llm):
    run = await _run(apex["org"])
    assert run["status"] == "done" and run["appsScanned"] == [APP]
    assert run["counts"]["business"] == 1 and run["counts"]["developer"] == 1 and run["counts"]["engineering"] == 1

    async with _client("business") as biz:
        [s] = (await biz.get("/api/v1/sightings")).json()
    assert s["view"]["title"] == "Refunds feel slow to customers"
    assert "endpoint" not in s["view"]["why"]           # the lint sent it back for a rewrite
    assert s["evidence"] == [] and s["impact"] == "high"  # business never receives page refs or code
    assert set(s["otherSeats"]) == {"product"}

    async with _client("product") as po:
        [p] = (await po.get("/api/v1/sightings")).json()
    assert p["id"] == s["id"] and [e["ref"] for e in p["evidence"]] == [f"{APP}/entities/refund"]  # unread page dropped

    async with _client("developer") as dev:
        [d] = (await dev.get("/api/v1/sightings")).json()
    assert d["id"] != s["id"] and {e["kind"] for e in d["evidence"]} == {"code", "kb"}
    async with _client("engineering") as lead:
        assert [x["id"] for x in (await lead.get("/api/v1/sightings")).json()] == [d["id"]]

    assert any(ev["type"] == "sightings.ready" for _, ev in apex["events"])
    assert {ev["payload"].get("node") for _, ev in apex["events"] if ev["type"] == "node_started"} >= {"collect", "scout", "review", "write"}


async def test_unchanged_apps_are_skipped_and_forced_runs_dont_repeat(apex, sighting_llm):
    await _run(apex["org"])
    from nox_api.db.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:  # a scheduled run: nothing changed since the last look
        run = await sightings.start_run(db, uuid.UUID(apex["org"]), trigger="schedule")
    await sightings.run_sightings(str(run.id))
    async with _client("engineering") as lead:
        latest = (await lead.get(f"/api/v1/orgs/{apex['org']}/sightings/runs")).json()[0]
    assert latest["appsScanned"] == [] and latest["appsSkipped"] == [APP]

    again = await _run(apex["org"])  # forced: everything is looked at, and the same finds are recognised
    assert again["appsScanned"] == [APP] and again["counts"]["business"] == 0 and again["counts"]["developer"] == 0
    async with _client("business") as biz:
        assert len((await biz.get("/api/v1/sightings")).json()) == 1


async def test_start_mission_is_one_click_from_the_clickers_seat(apex, sighting_llm, monkeypatch):
    seen_origin: dict = {}

    async def fake_generate(mission, role, upstream, context, current=None, instruction=None, origin=None, **kw):
        seen_origin[role] = origin
        return f"# {role.value} file\n\n## Verification checklist\n- [ ] it works\n"

    from nox_api.missions import drafting

    monkeypatch.setattr(drafting, "generate_file", fake_generate)
    await _run(apex["org"])
    async with _client("developer") as dev:
        [d] = (await dev.get("/api/v1/sightings")).json()
        m = (await dev.post(f"/api/v1/sightings/{d['id']}/launch")).json()
        assert m["createdAsRole"] == "developer" and m["sightingId"] == d["id"] and m["type"] == "change"
        assert m["prompt"].startswith("Make Refund.status read the ledger") and [a["name"] for a in m["apps"]] == [APP]
        await _wait_drafts(dev, m["key"])
        again = await dev.post(f"/api/v1/sightings/{d['id']}/launch")
        assert again.status_code == 409 and m["key"] in again.text
        assert (await dev.get("/api/v1/sightings")).json() == []
        [launched] = (await dev.get("/api/v1/sightings?status=launched")).json()
        assert launched["mission"]["key"] == m["key"] and launched["mission"]["startedAs"] == "developer"
    # every upstream draft saw where the mission came from, filtered for its reader
    assert "src/refund.py:3" in seen_origin[Role.developer] and "src/refund.py" not in seen_origin[Role.business]
    assert "Where this came from" in seen_origin[Role.business]
    async with _client("engineering") as lead:  # the other seat's card now shows it in flight
        [x] = (await lead.get("/api/v1/sightings?status=launched")).json()
        assert x["mission"]["key"] == m["key"]


async def test_a_done_mission_marks_its_sighting_shipped(apex, sighting_llm, fake_nox):
    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import Mission, MissionStage

    await _run(apex["org"])
    async with _client("developer") as dev:
        [d] = (await dev.get("/api/v1/sightings")).json()
        m = (await dev.post(f"/api/v1/sightings/{d['id']}/launch")).json()
        await _wait_drafts(dev, m["key"])
    async with AsyncSessionLocal() as db:
        mission = await db.get(Mission, uuid.UUID(m["id"]))
        mission.stage = MissionStage.done
        await db.commit()
        await sightings.mark_shipped(db, mission)
    async with _client("engineering") as lead:
        [x] = (await lead.get("/api/v1/sightings?status=launched")).json()
        assert x["status"] == "shipped" and x["mission"]["key"] == m["key"]
    assert any(ev["type"] == "sighting.shipped" for _, ev in apex["events"])


async def test_edit_first_launches_through_the_new_mission_form(apex, sighting_llm, fake_nox):
    await _run(apex["org"])
    async with _client("business") as biz:
        [s] = (await biz.get("/api/v1/sightings")).json()
        m = (await biz.post("/api/v1/missions", json={"prompt": "Tell customers when their refund money will land",
                                                      "appIds": [apex["kb"]], "sightingId": s["id"]})).json()
        assert m["sightingId"] == s["id"]
        assert (await biz.get(f"/api/v1/sightings/{s['id']}")).json()["status"] == "launched"


async def test_dismiss_and_snooze_take_it_out_of_the_feed(apex, sighting_llm):
    await _run(apex["org"])
    async with _client("business") as biz:
        [s] = (await biz.get("/api/v1/sightings")).json()
        r = (await biz.post(f"/api/v1/sightings/{s['id']}/feedback", json={"action": "dismissed", "reason": "already_known"})).json()
        assert r["status"] == "dismissed" and r["statusReason"] == "We already know"
        assert (await biz.get("/api/v1/sightings")).json() == []
        assert (await biz.post(f"/api/v1/sightings/{s['id']}/launch")).status_code == 409
        r = (await biz.post(f"/api/v1/sightings/{s['id']}/feedback", json={"action": "restore"})).json()
        assert r["status"] == "open"
    async with _client("developer") as dev:
        [d] = (await dev.get("/api/v1/sightings")).json()
        r = (await dev.post(f"/api/v1/sightings/{d['id']}/feedback", json={"action": "snoozed"})).json()
        assert r["status"] == "snoozed" and r["snoozedUntil"]
    async with _client("business") as biz:  # dismissals, with their reasons, reach the next scouts
        await biz.post(f"/api/v1/sightings/{s['id']}/feedback", json={"action": "dismissed", "reason": "wrong"})
    from nox_api.db.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        lines = await sightings._dismissed_lines(db, uuid.UUID(apex["org"]))
    assert any("NoX got it wrong" in x for x in lines[Role.business])


# ── Access ───────────────────────────────────────────────────────────────────


async def test_schedule_and_run_need_the_manage_capability(apex):
    org = apex["org"]
    body = {"cadence": "daily", "hour": 7, "timezone": "Europe/London", "seats": ["business", "developer"], "focus": ["cost", "nonsense"]}
    for role in ("business", "developer"):
        async with _client(role) as c:
            assert (await c.put(f"/api/v1/orgs/{org}/sightings/settings", json=body)).status_code == 403
            assert (await c.post(f"/api/v1/orgs/{org}/sightings/run")).status_code == 403
            assert (await c.get(f"/api/v1/orgs/{org}/sightings/settings")).json()["cadence"] == "weekly"
    async with _client("product") as po:
        s = (await po.put(f"/api/v1/orgs/{org}/sightings/settings", json=body)).json()
        assert s["cadence"] == "daily" and s["focus"] == ["cost"] and s["seats"] == ["business", "developer"] and s["nextRunAt"]
        assert (await po.put(f"/api/v1/orgs/{org}/sightings/settings", json={**body, "timezone": "Mars/Base"})).status_code == 422
        listed = (await po.get("/api/v1/sightings/schedules")).json()
        assert listed["orgs"][0]["schedule"]["cadence"] == "daily" and listed["orgs"][0]["canManage"] is True


async def test_outsiders_see_nothing(apex, sighting_llm):
    await _run(apex["org"])
    async with _client("business") as biz:
        [s] = (await biz.get("/api/v1/sightings")).json()
    async with _client("business", email="outsider@example.com") as out:
        assert (await out.get("/api/v1/sightings")).json() == []
        assert (await out.get(f"/api/v1/sightings/{s['id']}")).status_code == 404
        assert (await out.post(f"/api/v1/sightings/{s['id']}/launch")).status_code == 404
        assert (await out.get(f"/api/v1/orgs/{apex['org']}/sightings/settings")).status_code == 404
    async with _client("engineering") as lead:  # a seat without a view of it can't open or launch it
        assert (await lead.get(f"/api/v1/sightings/{s['id']}")).status_code == 404


async def test_tick_is_for_the_scheduler_and_starts_due_runs_once(apex, sighting_llm, monkeypatch):
    from nox_api.core.config import settings
    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import SightingSchedule

    monkeypatch.setattr(settings, "NOX_SIGHTINGS_TICK_SECRET", "tick-secret-0123456789")
    dispatched: list = []
    from nox_api.workers import dispatcher

    monkeypatch.setattr(dispatcher, "dispatch_sightings_run", lambda run_id, force=False: dispatched.append(run_id))
    async with _client("engineering") as c:
        assert (await c.post("/api/v1/internal/sightings/tick")).status_code == 403
        assert (await c.post("/api/v1/internal/sightings/tick", headers={"X-Nox-Tick": "wrong"})).status_code == 403
        first = (await c.post("/api/v1/internal/sightings/tick", headers={"X-Nox-Tick": "tick-secret-0123456789"})).json()
        assert first["started"] == []  # the default weekly schedule was created, and isn't due yet
    async with AsyncSessionLocal() as db:
        from sqlalchemy import select

        s = (await db.execute(select(SightingSchedule))).scalars().one()
        assert s.cadence == "weekly" and s.next_run_at > sightings.utcnow()
        s.next_run_at = datetime(2026, 1, 1)
        await db.commit()
    started = await sightings.tick()
    assert len(started) == 1 and dispatched == started
    assert await sightings.tick() == [] and len(dispatched) == 1  # moved to its next time: not started twice
