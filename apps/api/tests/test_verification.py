import asyncio
import uuid

import pytest

from nox_api.missions.verification import (
    clean_evidence,
    failing,
    norm_item,
    parse_checklist,
    update_kind,
    write_checklist,
)
from tests.test_missions import _client, _setup_app, _wait_drafts

MD = "# Build spec: X\n\n## Tasks\n- a\n\n## Verification checklist\n- [ ] Locks after 5 tries\n- [x] Tests pass\n  - Note: CI green\n\n## Appendix\nkeep me\n"


def test_checklist_round_trip():
    items = parse_checklist(MD)
    assert items == [
        {"text": "Locks after 5 tries", "checked": False, "verdict": None, "note": None, "evidence": []},
        {"text": "Tests pass", "checked": True, "verdict": "verified", "note": "CI green", "evidence": []},
    ]
    out = write_checklist(MD, [{**items[0], "checked": True, "note": "on staging"}, {**items[1], "note": None}])
    assert "- [x] Locks after 5 tries\n  - Note: on staging\n- [x] Tests pass\n\n## Appendix\nkeep me\n" in out
    assert out.startswith("# Build spec: X\n\n## Tasks\n- a\n") and parse_checklist(out)[0]["note"] == "on staging"
    assert parse_checklist("# no checklist\n") == []


async def _to_build(kb: str) -> str:
    async with _client("developer") as dev:
        key = (await dev.post("/api/v1/missions", json={"prompt": "Lock accounts after failed logins", "appIds": [kb]})).json()["key"]
        await _wait_drafts(dev, key)
        await dev.post(f"/api/v1/missions/{key}/proceed")
        assert (await dev.post(f"/api/v1/missions/{key}/files/developer/approve")).json()["stage"] == "build"
    return key


async def _verify(role: str, key: str, verdict="verified", **extra):
    async with _client(role) as c:
        if verdict == "verified":
            assert (await c.put(f"/api/v1/missions/{key}/files/{role}/verification", json={"items": [{"checked": True, "note": f"{role} ok"}]})).status_code == 200
        return (await c.post(f"/api/v1/missions/{key}/files/{role}/verify", json={"verdict": verdict, **extra})).json()


async def test_reverse_verification_round_trip(db_clean, fake_nox):
    kb = await _setup_app()
    key = await _to_build(kb)
    async with _client("product") as po:
        assert (await po.post(f"/api/v1/missions/{key}/complete")).status_code == 403
    async with _client("developer") as dev:
        m = (await dev.post(f"/api/v1/missions/{key}/complete")).json()
        assert m["stage"] == "verifying" and m["verifyRole"] == "developer"
        assert (await dev.post(f"/api/v1/missions/{key}/files/developer/verify", json={"verdict": "verified"})).status_code == 409  # unticked
    async with _client("engineering") as eng:
        assert (await eng.post(f"/api/v1/missions/{key}/files/engineering/verify", json={"verdict": "verified"})).status_code == 409  # not their turn

    m = await _verify("developer", key)
    assert m["verifyRole"] == "engineering"
    dev_file = next(f for f in m["files"] if f["role"] == "developer")
    assert "- [x] it works\n  - Note: developer ok" in dev_file["markdown"] and dev_file["verification"]["result"] == "verified"

    # engineering: not met → back to Build, then round two
    async with _client("engineering") as eng:
        assert (await eng.post(f"/api/v1/missions/{key}/files/engineering/verify", json={"verdict": "not_met"})).status_code == 400
    m = await _verify("engineering", key, verdict="not_met", note="Contract changed without a version bump")
    assert m["stage"] == "build" and m["verifyRole"] is None
    async with _client("developer") as dev:
        m = (await dev.post(f"/api/v1/missions/{key}/complete")).json()
        assert m["verifyRole"] == "developer"
        assert next(f for f in m["files"] if f["role"] == "developer")["verification"]["items"][0]["checked"] is True  # ticks survive

    for role, nxt in [("developer", "engineering"), ("engineering", "product"), ("product", "business"), ("business", None)]:
        m = await _verify(role, key)
        assert m["verifyRole"] == nxt
    assert m["stage"] == "done" and m["completedAt"]

    async with _client("business") as biz:
        events = [e["type"] for e in (await biz.get(f"/api/v1/missions/{key}/events")).json()]
        assert events.count("verify.verified") == 5 and "verify.not_met" in events and "mission.completed" in events


async def test_coming_back_view(db_clean, fake_nox):
    kb = await _setup_app()
    key = await _to_build(kb)
    async with _client("developer") as dev:
        await dev.post(f"/api/v1/missions/{key}/complete")
        assert [m["key"] for m in (await dev.get("/api/v1/missions?view=back")).json()] == [key]
    async with _client("business") as biz:
        assert (await biz.get("/api/v1/missions?view=back")).json() == []


MEDIA_ID = str(uuid.uuid4())


def test_verdicts_and_evidence_survive_the_file():
    items = [
        {"text": "Locks after 5 tries", "verdict": "verified", "note": "on staging",
         "evidence": [{"type": "link", "label": "CI run 4812", "url": "https://ci.example/4812"}, {"type": "capture", "mediaId": MEDIA_ID}]},
        {"text": "Support can unlock", "verdict": "failed", "note": "no button", "evidence": [{"type": "metric", "name": "unlock tickets", "value": "42"}]},
        {"text": "Audit log written", "verdict": "cant", "note": None, "evidence": [{"type": "note", "text": "log store is read-only for me"}]},
        {"text": "Emails sent", "verdict": None, "note": None, "evidence": []},
    ]
    md = write_checklist(MD, items)
    assert "- [x] Locks after 5 tries\n  - Evidence: [CI run 4812](https://ci.example/4812)\n  - Evidence: [[media:" in md
    assert "- [ ] Support can unlock\n  - Verdict: failed\n  - Evidence: Metric: unlock tickets = 42\n  - Note: no button\n" in md
    assert "  - Verdict: cannot verify\n" in md and md.endswith("keep me\n")
    back = parse_checklist(md)
    assert [(i["verdict"], i["checked"]) for i in back] == [("verified", True), ("failed", False), ("cant", False), (None, False)]
    assert back[0]["evidence"] == items[0]["evidence"] and back[1]["evidence"] == items[1]["evidence"] and back[2]["evidence"] == items[2]["evidence"]
    assert write_checklist(md, back) == md  # writing what was read changes nothing


def test_older_items_with_only_a_tick_still_work():
    assert norm_item({"text": "a", "checked": True, "note": "ok"})["verdict"] == "verified"
    assert norm_item({"text": "a", "checked": False})["verdict"] is None
    # a tick wins over a stale verdict line
    assert parse_checklist("## Verification checklist\n- [x] a\n  - Verdict: failed\n")[0]["verdict"] == "verified"


def test_evidence_is_validated():
    assert clean_evidence([{"type": "link", "url": "https://x.example/a", "label": ""}])[0]["label"] == "https://x.example/a"
    for bad in ({"type": "link", "url": "javascript:alert(1)"}, {"type": "capture", "mediaId": "nope"}, {"type": "metric", "name": "x", "value": ""},
                {"type": "note", "text": "  "}, {"type": "video"}):
        with pytest.raises(ValueError):
            clean_evidence([bad])
    with pytest.raises(ValueError):
        clean_evidence([{"type": "note", "text": "n"}] * 6)


def test_update_kind_and_failing_items():
    v, f, n = ({"text": "a", "verdict": "verified"}, {"text": "b", "verdict": "failed"}, {"text": "c", "verdict": None})
    assert update_kind([v, f]) == "partial" and update_kind([f, n]) == "rework"
    assert [i["text"] for i in failing([v, f, n])] == ["b"]  # marked failed wins
    assert [i["text"] for i in failing([v, n])] == ["c"]  # nothing marked: whatever isn't verified


async def _to_verifying() -> str:
    key = await _to_build(await _setup_app())
    async with _client("developer") as dev:
        assert (await dev.post(f"/api/v1/missions/{key}/complete")).status_code == 200
    return key


async def _developer_file(key: str) -> dict:
    async with _client("developer") as dev:
        return next(f for f in (await dev.get(f"/api/v1/missions/{key}")).json()["files"] if f["role"] == "developer")


async def test_verdicts_and_evidence_through_the_api(db_clean, fake_nox):
    key = await _to_verifying()
    url = f"/api/v1/missions/{key}/files/developer/verification"
    async with _client("developer") as dev:
        bad = await dev.put(url, json={"items": [{"verdict": "verified", "evidence": [{"type": "link", "url": "ftp://x"}]}]})
        assert bad.status_code == 400 and "http" in bad.json()["detail"]
        foreign = await dev.put(url, json={"items": [{"verdict": "verified", "evidence": [{"type": "capture", "mediaId": str(uuid.uuid4())}]}]})
        assert foreign.status_code == 400
        ev = [{"type": "link", "label": "CI run 4812", "url": "https://ci.example/4812"}]
        f = (await dev.put(url, json={"items": [{"verdict": "failed", "note": "", "evidence": ev}]})).json()
        assert f["verification"]["items"][0]["verdict"] == "failed" and "Evidence: [CI run 4812]" in f["markdown"]
        # a client that only sends `checked` keeps the evidence
        f = (await dev.put(url, json={"items": [{"checked": True}]})).json()
        assert f["verification"]["items"][0]["verdict"] == "verified" and f["verification"]["items"][0]["evidence"] == ev
        f = (await dev.put(url, json={"items": [{"verdict": "cant", "note": "no access to the audit store"}]})).json()
        assert (await dev.post(f"/api/v1/missions/{key}/files/developer/verify", json={"verdict": "verified"})).status_code == 409  # can't verify blocks


async def test_blocked_update_keeps_the_mission_in_place(db_clean, fake_nox):
    key = await _to_verifying()
    url = f"/api/v1/missions/{key}/files/developer"
    async with _client("developer") as dev:
        assert (await dev.post(f"{url}/verify", json={"verdict": "blocked", "note": "waiting"})).status_code == 400  # nothing marked
        await dev.put(f"{url}/verification", json={"items": [{"verdict": "cant", "note": "no access"}]})
        assert (await dev.post(f"{url}/verify", json={"verdict": "blocked"})).status_code == 400  # needs a note
        m = (await dev.post(f"{url}/verify", json={"verdict": "blocked", "note": "Waiting on staging access"})).json()
        assert m["stage"] == "verifying" and m["verifyRole"] == "developer"
        assert next(f for f in m["files"] if f["role"] == "developer")["verification"]["blocked"]["note"] == "Waiting on staging access"
        # settle it and carry on: the block clears
        await dev.put(f"{url}/verification", json={"items": [{"verdict": "verified", "note": "access granted"}]})
        m = (await dev.post(f"{url}/verify", json={"verdict": "verified"})).json()
        assert m["verifyRole"] == "engineering" and "blocked" not in next(f for f in m["files"] if f["role"] == "developer")["verification"]
        updates = (await dev.get(f"/api/v1/missions/{key}/updates")).json()
        assert [u["kind"] for u in updates] == ["completed", "blocked"] and updates[1]["items"][0]["verdict"] == "cant"


async def test_partial_update_sends_back_only_what_failed_and_rechecks_only_that(db_clean, fake_nox, monkeypatch):
    # a two-item checklist on every file
    async def gen(mission, role, upstream, context, current=None, instruction=None, **kw):
        return f"# {role.value}\n\n## Verification checklist\n- [ ] first thing\n- [ ] second thing\n"

    from nox_api.missions import drafting

    monkeypatch.setattr(drafting, "generate_file", gen)
    key = await _to_verifying()
    async with _client("developer") as dev:
        await dev.put(f"/api/v1/missions/{key}/files/developer/verification", json={"items": [{"verdict": "verified"}, {"verdict": "verified"}]})
        await dev.post(f"/api/v1/missions/{key}/files/developer/verify", json={"verdict": "verified"})
    async with _client("engineering") as eng:
        url = f"/api/v1/missions/{key}/files/engineering"
        await eng.put(f"{url}/verification", json={"items": [{"verdict": "verified"}, {"verdict": "failed"}]})
        no_reason = await eng.post(f"{url}/verify", json={"verdict": "not_met", "note": "Contract not versioned"})
        assert no_reason.status_code == 400 and "second thing" in no_reason.json()["detail"]
        await eng.put(f"{url}/verification", json={"items": [{"verdict": "verified"}, {"verdict": "failed", "note": "no version bump", "evidence": [{"type": "note", "text": "diff shows v1 still"}]}]})
        m = (await eng.post(f"{url}/verify", json={"verdict": "not_met", "note": "Contract not versioned"})).json()
        assert m["stage"] == "build"
        updates = (await eng.get(f"/api/v1/missions/{key}/updates")).json()
        u = updates[0]
        assert (u["kind"], u["role"], u["toRole"], u["note"]) == ("partial", "engineering", "developer", "Contract not versioned")
        assert [i["text"] for i in u["items"]] == ["second thing"] and u["items"][0]["evidence"][0]["text"] == "diff shows v1 still"
    async with _client("developer") as dev:
        m = (await dev.post(f"/api/v1/missions/{key}/complete")).json()
        eng_items = next(f for f in m["files"] if f["role"] == "engineering")["verification"]["items"]
        assert [(i["verdict"], bool(i.get("recheck"))) for i in eng_items] == [("verified", False), (None, True)]  # only the failed one comes back
        assert eng_items[1]["evidence"]  # its evidence stays for the re-check
    for role in ("developer", "engineering"):
        async with _client(role) as c:
            if role == "engineering":
                await c.put(f"/api/v1/missions/{key}/files/engineering/verification", json={"items": [{"verdict": "verified"}, {"verdict": "verified"}]})
            else:
                await c.put(f"/api/v1/missions/{key}/files/developer/verification", json={"items": [{"verdict": "verified"}, {"verdict": "verified"}]})
            assert (await c.post(f"/api/v1/missions/{key}/files/{role}/verify", json={"verdict": "verified"})).status_code == 200


async def test_developer_file_gets_the_mission_prs_attached(db_clean, fake_nox):
    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import ExternalLink, Mission

    key = await _to_build(await _setup_app())
    async with AsyncSessionLocal() as db:
        from sqlalchemy import select

        mission = (await db.execute(select(Mission).where(Mission.number == int(key.split("-")[1])))).scalars().first()
        db.add(ExternalLink(mission_id=mission.id, system="github_pr", external_id="apex/refunds#12", url="https://github.com/apex/refunds/pull/12", primary=False, state={"state": "merged"}))
        await db.commit()
    async with _client("developer") as dev:
        m = (await dev.post(f"/api/v1/missions/{key}/complete")).json()
    assert next(f for f in m["files"] if f["role"] == "developer")["verification"]["auto"] == [{"label": "apex/refunds#12 · merged", "url": "https://github.com/apex/refunds/pull/12"}]


async def test_evidence_check_gives_hints_and_never_changes_a_verdict(db_clean, fake_nox, monkeypatch):
    from .ai_fakes import FakeLlm, data, use_fake

    use_fake(monkeypatch, FakeLlm(responder=lambda req: data({"items": [{"index": 0, "fit": "unclear", "why": "It is only a link NoX cannot open."}, {"index": 7, "fit": "supports", "why": "out of range"}]})))
    key = await _to_verifying()
    url = f"/api/v1/missions/{key}/files/developer"
    async with _client("developer") as dev:
        assert (await dev.post(f"{url}/verification/evidence-check")).status_code == 409  # no evidence yet
        await dev.put(f"{url}/verification", json={"items": [{"verdict": "verified", "evidence": [{"type": "link", "label": "CI", "url": "https://ci.example/1"}]}]})
        assert (await dev.post(f"{url}/verification/evidence-check")).status_code == 202
        for _ in range(200):
            v = (await dev.get(f"/api/v1/missions/{key}")).json()["files"]
            v = next(f for f in v if f["role"] == "developer")["verification"]
            if v.get("checks"):
                break
            await asyncio.sleep(0.05)
        assert v["checks"] == [{"index": 0, "fit": "unclear", "why": "It is only a link NoX cannot open."}]
        assert v["items"][0]["verdict"] == "verified"
    async with _client("business") as biz:
        assert (await biz.post(f"{url}/verification/evidence-check")).status_code == 403
