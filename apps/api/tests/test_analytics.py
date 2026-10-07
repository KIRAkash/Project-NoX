"""Flight recorder: rows queued for BigQuery (fake client), never raising, and the Impact numbers from Postgres."""

import uuid
from datetime import datetime, timedelta

from nox_api.core.time_utils import now_utc_naive

import pytest

from nox_api.core.config import settings
from nox_api.services import analytics

from .test_missions import _client, _setup_app, _wait_drafts


class FakeBigQuery:
    def __init__(self, fail: bool = False):
        self.fail = fail
        self.inserted: dict[str, list[dict]] = {}

    def insert_rows_json(self, table, rows, row_ids=None):
        if self.fail:
            raise ConnectionError("BigQuery unreachable")
        self.inserted.setdefault(table.rsplit(".", 1)[-1], []).extend(rows)
        return []


@pytest.fixture
def bq(monkeypatch):
    fake = FakeBigQuery()
    monkeypatch.setattr(settings, "NOX_ANALYTICS", "bigquery")
    monkeypatch.setattr(settings, "NOX_AI_BACKEND", "api_key")
    monkeypatch.setattr(settings, "GOOGLE_CLOUD_PROJECT", "nox-test")
    monkeypatch.setattr(analytics._sink, "client", fake)
    analytics._sink.rows.clear()
    yield fake
    analytics._sink.rows.clear()


async def test_record_enqueues_a_mission_event_row(bq, db_clean, fake_nox):
    kb = await _setup_app()
    async with _client("business") as biz:
        key = (await biz.post("/api/v1/missions", json={"prompt": "Show customers their refund status", "appIds": [kb]})).json()["key"]
        await _wait_drafts(biz, key)
    analytics.flush()
    rows = bq.inserted["mission_events"]
    created = next(r for r in rows if r["type"] == "mission.created")
    assert created["mission_key"] == key and created["stage"] == "business" and created["actor_role"] == "business"
    assert created["org_id"] and created["event_id"] and created["at"]
    assert '"prompt"' in created["payload"]  # payload travels as JSON text
    drafted = next(r for r in rows if r["type"] == "file.drafted")
    assert '"citations": 0' in drafted["payload"] and '"tokens"' in drafted["payload"]


async def test_record_does_nothing_with_analytics_off(db_clean, fake_nox, monkeypatch):
    fake = FakeBigQuery()
    monkeypatch.setattr(analytics._sink, "client", fake)
    kb = await _setup_app()
    async with _client("business") as biz:
        await biz.post("/api/v1/missions", json={"prompt": "Show customers their refund status", "appIds": [kb]})
    assert analytics._sink.rows == {} and analytics.flush() == 0 and fake.inserted == {}


def test_a_flush_failure_never_raises(bq, monkeypatch):
    monkeypatch.setattr(analytics._sink, "client", FakeBigQuery(fail=True))
    analytics.emit("ai_usage", {"label": "ask", "calls": 1})
    assert analytics.flush() == 0 and analytics._sink.rows == {}  # dropped, logged, not raised


def test_outermost_usage_scope_goes_to_ai_usage(bq):
    from nox_api.ai import telemetry

    with telemetry.tags(org_id="org-1", mission_id="m-1"):
        with telemetry.usage_scope("cowrite:product") as outer:
            with telemetry.usage_scope("draft:product"):
                telemetry.record_tool_call()
            outer.tags["citations"] = "2"
    analytics.flush()
    rows = bq.inserted["ai_usage"]
    assert len(rows) == 1  # nested scopes aren't counted twice
    assert rows[0]["label"] == "cowrite:product" and rows[0]["tool_calls"] == 1
    assert rows[0]["org_id"] == "org-1" and rows[0]["mission_id"] == "m-1" and rows[0]["citations"] == 2


async def _seed_mission(kb_id: str) -> str:
    """NOX-1: business → product → engineering → developer → build → sent back to engineering → … → done."""
    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import KnowledgeBase, Mission, MissionEvent, MissionStage, Role

    t0 = now_utc_naive() - timedelta(days=2)
    h = timedelta(hours=1)
    steps = [  # (hours after creation, type, stage after it)
        (0, "mission.created", "business"), (1, "file.approved", "product"), (3, "file.approved", "engineering"),
        (4, "file.approved", "developer"), (5, "file.approved", "build"), (6, "mission.sent_back", "engineering"),
        (8, "file.approved", "developer"), (9, "file.approved", "build"), (11, "mission.completed", "verifying"),
        (12, "verify.verified", "done"),
    ]
    async with AsyncSessionLocal() as db:
        kb = await db.get(KnowledgeBase, uuid.UUID(kb_id))
        m = Mission(number=1, org_id=kb.org_id, primary_kb_id=kb.id, title="Refund status", prompt="Show refund status",
                    stage=MissionStage.done, created_as_role=Role.business, created_at=t0)
        db.add(m)
        await db.flush()
        for hours, kind, stage in steps:
            db.add(MissionEvent(mission_id=m.id, type=kind, payload={"stage": stage, **({"citations": 3} if kind == "file.approved" and stage == "product" else {})},
                                created_at=t0 + hours * h))
        db.add(MissionEvent(mission_id=m.id, type="file.drafted", payload={"stage": "business", "citations": 2,
                                                                           "tokens": {"input": 1_000_000, "cached": 0, "output": 0}},
                            created_at=t0 + timedelta(minutes=5)))
        db.add(MissionEvent(mission_id=m.id, type="file.drafted", payload={"stage": "business", "citations": 0}, created_at=t0 + timedelta(minutes=6)))
        await db.commit()
        return str(kb.org_id)


async def test_impact_from_postgres_computes_stage_durations_and_send_backs(db_clean):
    kb = await _setup_app()
    org_id = await _seed_mission(kb)
    async with _client("business") as biz:  # the business seat reads Impact too
        r = await biz.get(f"/api/v1/orgs/{org_id}/impact", params={"days": 30})
    assert r.status_code == 200
    got = r.json()
    assert got["source"] == "postgres" and got["missions"] == 1 and got["missionsDone"] == 1
    assert got["medianTimeToVerified"] == 12 * 3600
    stages = {s["stage"]: s["seconds"] for s in got["stageMedians"]}
    # engineering: 3→4 and 6→8 = 3 h; developer: 4→5 and 8→9 = 2 h; build: 5→6 and 9→11 = 3 h
    assert stages == {"business": 3600, "product": 7200, "engineering": 10800, "developer": 7200, "build": 10800, "verifying": 3600}
    assert got["sendBacks"] == 1 and got["sendBacksByStage"] == [{"stage": "build", "count": 1}]
    assert got["groundedShare"] == 0.5 and got["groundedBasis"] == "2 drafted spec files"
    assert got["aiCostPerMission"] == 0.3  # 1M fresh input tokens at the dated list price
    assert got["recent"][0]["key"] == "NOX-1" and got["recent"][0]["flightSeconds"] == 12 * 3600


async def test_impact_is_404_for_a_non_member(db_clean):
    kb = await _setup_app()
    org_id = await _seed_mission(kb)
    async with _client("engineering", email="outsider@example.com") as other:
        assert (await other.get(f"/api/v1/orgs/{org_id}/impact")).status_code == 404


async def test_mission_flight_strip(db_clean):
    kb = await _setup_app()
    await _seed_mission(kb)
    async with _client("business") as biz:
        got = (await biz.get("/api/v1/missions/NOX-1/flight")).json()
    stages = {s["stage"]: s["seconds"] for s in got["stages"]}
    assert stages["engineering"] == 10800 and "done" not in stages
    async with _client("business", email="outsider@example.com") as other:
        assert (await other.get("/api/v1/missions/NOX-1/flight")).status_code == 404
