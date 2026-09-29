from nox_api.missions.verification import parse_checklist, write_checklist
from tests.test_missions import _client, _setup_app, _wait_drafts

MD = "# Build spec: X\n\n## Tasks\n- a\n\n## Verification checklist\n- [ ] Locks after 5 tries\n- [x] Tests pass\n  - Note: CI green\n\n## Appendix\nkeep me\n"


def test_checklist_round_trip():
    items = parse_checklist(MD)
    assert items == [{"text": "Locks after 5 tries", "checked": False, "note": None}, {"text": "Tests pass", "checked": True, "note": "CI green"}]
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
