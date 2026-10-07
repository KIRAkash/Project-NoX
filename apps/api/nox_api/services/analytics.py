"""The flight recorder: mission, knowledge-base and AI events streamed to BigQuery, and the Impact numbers.

Why: every mission already records timestamped events (`missions/events.record()`), every KB build logs its
steps (`agents/runner.log_event`), and every AI unit of work reports calls, tokens and time
(`ai/telemetry.usage_scope`). Streaming those into BigQuery turns "NoX makes delivery faster" into
evidence: time from sentence to verified code, where work waits, send-backs, grounding and AI cost.

Shape of the flow:

  emit(table, row)  → an in-process buffer (no-op when NOX_ANALYTICS=off, the default locally and in tests)
  flusher thread    → `insert_rows_json` (streaming insert) every 5 s or every 500 rows
  impact(org_ids)   → the Impact page's numbers: from the BigQuery views when NOX_ANALYTICS=bigquery,
                      otherwise computed from Postgres, so local dev, tests and NoX Local show the page too

Postgres stays authoritative (principle 5): a failed flush logs a warning and drops the batch, and
`python -m nox_api.services.analytics backfill [--since DATE]` can always rebuild the tables.
The flusher is a thread, not an asyncio task, because Celery runs each job in its own short-lived event loop.
"""

from __future__ import annotations

import atexit
import json
import logging
import statistics
import threading
import time
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

from ..core.time_utils import now_utc_naive

from ..core.config import settings

logger = logging.getLogger(__name__)

TABLES = ("mission_events", "kb_events", "ai_usage", "shield_findings")
FLUSH_SECONDS = 5.0
FLUSH_ROWS = 500
VIEWS_SQL = Path(__file__).with_name("analytics_views.sql")

# USD per million tokens, Gemini Flash-class list prices as read on 2026-09-29. Keep in step with the
# `price` CTE in analytics_views.sql; an estimate, labelled as such wherever it is shown.
PRICE_PER_MTOK = {"input": 0.30, "cached": 0.03, "output": 2.50, "thinking": 2.50}


def enabled() -> bool:
    if settings.NOX_ANALYTICS.strip().lower() != "bigquery":
        return False
    from ..ai import config

    return config.backend() != "local"  # NoX Local keeps working with no cloud dependency


def dataset() -> str:
    from ..ai import config

    return f"{config.project()}.{settings.NOX_BQ_DATASET}"


# ── Sink ─────────────────────────────────────────────────────────────────────


class _Sink:
    """Buffered streaming inserts on a daemon thread. `client` is swappable for tests."""

    def __init__(self):
        self.rows: dict[str, list[dict]] = {}
        self.lock = threading.Lock()
        self.wake = threading.Event()
        self.thread: threading.Thread | None = None
        self.client = None

    def put(self, table: str, row: dict) -> None:
        with self.lock:
            self.rows.setdefault(table, []).append(row)
            full = sum(len(v) for v in self.rows.values()) >= FLUSH_ROWS
        if self.thread is None or not self.thread.is_alive():
            self.thread = threading.Thread(target=self._loop, name="nox-flight-recorder", daemon=True)
            self.thread.start()
        if full:
            self.wake.set()

    def _loop(self) -> None:
        while True:
            self.wake.wait(FLUSH_SECONDS)
            self.wake.clear()
            self.flush()

    def flush(self) -> int:
        """Send everything buffered. Never raises: a failed batch is logged and dropped."""
        with self.lock:
            batches, self.rows = self.rows, {}
        sent = 0
        for table, rows in batches.items():
            try:
                client = self.client or _bq_client()
                errors = client.insert_rows_json(f"{dataset()}.{table}", rows, row_ids=[r.get("event_id") for r in rows])
                if errors:
                    logger.warning(f"flight recorder: {len(errors)} rows rejected by {table}: {str(errors[:1])[:300]}")
                sent += len(rows) - len(errors or [])
            except Exception as e:
                logger.warning(f"flight recorder: dropped {len(rows)} {table} rows ({type(e).__name__}: {e})")
        return sent


_sink = _Sink()
atexit.register(lambda: _sink.flush() if enabled() else None)


def _bq_client():
    from google.cloud import bigquery

    from ..ai import config

    return bigquery.Client(project=config.project())


def _jsonable(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, uuid.UUID):
        return str(v)
    return v


def emit(table: str, row: dict) -> None:
    """Queue one row for BigQuery. Cheap, never raises, never blocks a request."""
    if not enabled():
        return
    try:
        out = {k: _jsonable(v) for k, v in row.items()}
        out.setdefault("at", now_utc_naive().isoformat())
        out.setdefault("event_id", uuid.uuid4().hex)
        if isinstance(out.get("payload"), dict):
            out["payload"] = json.dumps(out["payload"], default=str)
        _sink.put(table, out)
    except Exception:
        logger.debug("flight recorder emit failed", exc_info=True)


def flush() -> int:
    return _sink.flush()


# ── Row builders (shared by the live hooks and the backfill) ────────────────


def mission_event_row(mission, ev) -> dict:
    return {"event_id": str(ev.id) if ev.id else uuid.uuid4().hex, "at": ev.created_at or now_utc_naive(), "org_id": mission.org_id,
            "mission_id": mission.id, "mission_key": mission.key, "type": ev.type, "actor_role": ev.acting_role,
            "stage": (ev.payload or {}).get("stage"), "payload": ev.payload or {}}


def kb_event_row(kb, ev) -> dict:
    return {"event_id": str(ev.id) if ev.id else uuid.uuid4().hex, "at": ev.created_at or now_utc_naive(), "org_id": kb.org_id, "kb_id": kb.id,
            "app": kb.app_name, "type": ev.event_type, "payload": ev.payload or {}}


# ── Impact numbers ───────────────────────────────────────────────────────────


def _median(xs: list[float]) -> float | None:
    return round(statistics.median(xs), 1) if xs else None


def cost_of(tokens: dict) -> float:
    """USD for one unit of work. Input tokens include the cached ones, which are billed at the cached rate."""
    cached = tokens.get("cached") or 0
    fresh = max(0, (tokens.get("input") or 0) - cached)
    return (fresh * PRICE_PER_MTOK["input"] + cached * PRICE_PER_MTOK["cached"]
            + (tokens.get("output") or 0) * PRICE_PER_MTOK["output"]
            + (tokens.get("thinking") or 0) * PRICE_PER_MTOK["thinking"]) / 1_000_000


def stage_segments(created_at: datetime, first_stage: str, events: list[tuple[datetime, str | None]],
                   now: datetime) -> list[dict]:
    """[{stage, start, end, seconds, open}] from a mission's events (each carries the stage after it)."""
    segs = [{"stage": first_stage, "start": created_at}]
    for at, stage in events:
        if stage and stage != segs[-1]["stage"]:
            segs[-1]["end"] = at
            segs.append({"stage": stage, "start": at})
    for s in segs:
        s["open"] = "end" not in s and s["stage"] != "done"
        end = s.get("end") or (now if s["open"] else s["start"])
        s["seconds"] = max(0.0, (end - s["start"]).total_seconds())
    return segs


async def mission_flight(db, mission) -> list[dict]:
    """Time spent in each stage for one mission (the strip above its timeline)."""
    from sqlalchemy import select

    from ..db.models import MissionEvent

    rows = (await db.execute(select(MissionEvent.created_at, MissionEvent.type, MissionEvent.payload)
                             .where(MissionEvent.mission_id == mission.id).order_by(MissionEvent.created_at))).all()
    first = next(((p or {}).get("stage") for _, t, p in rows if t == "mission.created"), None) or mission.stage.value
    segs = stage_segments(mission.created_at, first, [(at, (p or {}).get("stage")) for at, _, p in rows], now_utc_naive())
    totals: dict[str, float] = {}
    for s in segs:
        if s["stage"] != "done":
            totals[s["stage"]] = totals.get(s["stage"], 0.0) + s["seconds"]
    current = segs[-1]["stage"]
    return [{"stage": st, "seconds": round(sec), "current": st == current} for st, sec in totals.items()]


async def impact_from_postgres(db, org_ids: list, days: int) -> dict:
    from sqlalchemy import select

    from ..db.models import KBEvent, KnowledgeBase, Mission, MissionEvent

    since = now_utc_naive() - timedelta(days=days)
    now = now_utc_naive()
    missions = (await db.execute(select(Mission).where(Mission.org_id.in_(org_ids), Mission.created_at >= since)
                                 .order_by(Mission.created_at.desc()))).scalars().all()
    by_mission: dict = {m.id: [] for m in missions}
    if missions:
        evs = (await db.execute(select(MissionEvent).where(MissionEvent.mission_id.in_(list(by_mission)))
                                .order_by(MissionEvent.created_at))).scalars().all()
        for ev in evs:
            by_mission[ev.mission_id].append(ev)

    stage_totals: dict[str, list[float]] = {}
    to_verified, send_backs, recent = [], {}, []
    drafted = grounded = 0
    cost_by_mission: dict = {}
    for m in missions:
        evs = by_mission[m.id]
        first = next(((e.payload or {}).get("stage") for e in evs if e.type == "mission.created"), None) or m.stage.value
        segs = stage_segments(m.created_at, first, [(e.created_at, (e.payload or {}).get("stage")) for e in evs], now)
        per_stage: dict[str, float] = {}
        for s in segs:
            if not s["open"] and s["stage"] != "done":
                per_stage[s["stage"]] = per_stage.get(s["stage"], 0.0) + s["seconds"]
        for st, sec in per_stage.items():
            stage_totals.setdefault(st, []).append(sec)
        done_at = next((s["start"] for s in segs if s["stage"] == "done"), None)
        if done_at:
            to_verified.append((done_at - m.created_at).total_seconds())
        prev = first
        for e in evs:
            if e.type in ("mission.sent_back", "verify.not_met"):
                send_backs[prev] = send_backs.get(prev, 0) + 1
            prev = (e.payload or {}).get("stage") or prev
            if e.type == "file.drafted" and "citations" in (e.payload or {}):
                drafted += 1
                grounded += 1 if (e.payload or {}).get("citations") else 0
            tokens = (e.payload or {}).get("tokens")
            if isinstance(tokens, dict):
                cost_by_mission[m.id] = cost_by_mission.get(m.id, 0.0) + cost_of(tokens)
        recent.append({"key": m.key, "title": m.title, "stage": m.stage.value,
                       "flightSeconds": round(((done_at or now) - m.created_at).total_seconds())})

    kb_ids = (await db.execute(select(KnowledgeBase.id).where(KnowledgeBase.org_id.in_(org_ids)))).scalars().all()
    freshness = []
    if kb_ids:
        kevs = (await db.execute(select(KBEvent.kb_id, KBEvent.event_type, KBEvent.created_at)
                                 .where(KBEvent.kb_id.in_(kb_ids), KBEvent.created_at >= since,
                                        KBEvent.event_type.in_(["gatekeeper_evaluation_started", "pr_opened"]))
                                 .order_by(KBEvent.created_at))).all()
        started: dict = {}
        for kb_id, kind, at in kevs:
            if kind == "gatekeeper_evaluation_started":
                started[kb_id] = at
            elif kb_id in started:
                freshness.append((at - started.pop(kb_id)).total_seconds())

    return {
        "source": "postgres",
        "since": since.date().isoformat(),
        "days": days,
        "missions": len(missions),
        "missionsDone": len(to_verified),
        "medianTimeToVerified": _median(to_verified),
        "stageMedians": [{"stage": st, "seconds": _median(v), "missions": len(v)} for st, v in stage_totals.items()],
        "sendBacks": sum(send_backs.values()),
        "sendBacksByStage": [{"stage": st, "count": n} for st, n in sorted(send_backs.items(), key=lambda x: -x[1])],
        "groundedShare": round(grounded / drafted, 3) if drafted else None,
        "groundedBasis": f"{drafted} drafted spec files",
        "aiCostPerMission": round(sum(cost_by_mission.values()) / len(cost_by_mission), 4) if cost_by_mission else None,
        "kbFreshnessMedian": _median(freshness),
        "recent": recent[:8],
    }


_BQ_IMPACT = {
    "flow": """SELECT COUNT(*) AS missions, COUNTIF(verified_at IS NOT NULL) AS done,
                      APPROX_QUANTILES(IF(verified_at IS NOT NULL, seconds_to_verified, NULL), 2)[OFFSET(1)] AS median_to_verified,
                      SUM(send_backs) AS send_backs
               FROM `{ds}.mission_flow` WHERE org_id IN UNNEST(@orgs) AND created_at >= @since""",
    "stages": """SELECT stage, APPROX_QUANTILES(seconds, 2)[OFFSET(1)] AS seconds, COUNT(DISTINCT mission_id) AS missions
                 FROM `{ds}.mission_stage_durations` WHERE org_id IN UNNEST(@orgs) AND started_at >= @since
                 GROUP BY stage""",
    "send_backs": """SELECT from_stage AS stage, COUNT(*) AS count FROM `{ds}.mission_send_backs`
                     WHERE org_id IN UNNEST(@orgs) AND at >= @since GROUP BY stage ORDER BY count DESC""",
    "grounding": """SELECT SUM(answers) AS answers, SUM(grounded) AS grounded FROM `{ds}.grounding`
                    WHERE (org_id IS NULL OR org_id IN UNNEST(@orgs)) AND day >= DATE(@since)""",
    "cost": """SELECT AVG(usd) AS usd FROM `{ds}.ai_cost` WHERE org_id IN UNNEST(@orgs) AND mission_id IS NOT NULL
               AND first_at >= @since""",
    "freshness": """SELECT APPROX_QUANTILES(seconds, 2)[OFFSET(1)] AS seconds FROM `{ds}.kb_freshness`
                    WHERE org_id IN UNNEST(@orgs) AND pushed_at >= @since""",
}


def _bq_rows(sql: str, org_ids: list, since: datetime) -> list[dict]:
    from google.cloud import bigquery

    job = _bq_client().query(sql.format(ds=dataset()), job_config=bigquery.QueryJobConfig(query_parameters=[
        bigquery.ArrayQueryParameter("orgs", "STRING", [str(o) for o in org_ids]),
        bigquery.ScalarQueryParameter("since", "TIMESTAMP", since),
    ]))
    return [dict(r.items()) for r in job.result(timeout=20)]


async def impact_from_bigquery(db, org_ids: list, days: int) -> dict:
    import asyncio

    since = now_utc_naive() - timedelta(days=days)
    got = {k: await asyncio.to_thread(_bq_rows, sql, org_ids, since) for k, sql in _BQ_IMPACT.items()}
    flow = (got["flow"] or [{}])[0]
    ground = (got["grounding"] or [{}])[0]
    pg = await impact_from_postgres(db, org_ids, days)  # the recent-missions table reads the live records
    return {
        **pg,
        "source": "bigquery",
        "missions": flow.get("missions") or 0,
        "missionsDone": flow.get("done") or 0,
        "medianTimeToVerified": flow.get("median_to_verified"),
        "stageMedians": [{"stage": r["stage"], "seconds": r["seconds"], "missions": r["missions"]} for r in got["stages"]],
        "sendBacks": flow.get("send_backs") or 0,
        "sendBacksByStage": [{"stage": r["stage"], "count": r["count"]} for r in got["send_backs"]],
        "groundedShare": round(ground["grounded"] / ground["answers"], 3) if ground.get("answers") else None,
        "groundedBasis": f"{ground.get('answers') or 0} Ask answers and drafted spec files",
        "aiCostPerMission": round((got["cost"] or [{}])[0].get("usd") or 0, 4) or None,
        "kbFreshnessMedian": (got["freshness"] or [{}])[0].get("seconds"),
    }


async def impact(db, org_ids: list, days: int) -> dict:
    if enabled():
        try:
            return await impact_from_bigquery(db, org_ids, days)
        except Exception as e:
            logger.warning(f"Impact from BigQuery failed ({type(e).__name__}: {e}); computing from Postgres")
    return await impact_from_postgres(db, org_ids, days)


# ── Backfill ─────────────────────────────────────────────────────────────────


async def backfill(since: date | None = None) -> dict:
    """Replay stored mission and KB events into BigQuery (row ids make re-runs idempotent within BigQuery's window)."""
    from sqlalchemy import select

    from ..db.database import AsyncSessionLocal
    from ..db.models import KBEvent, KnowledgeBase, Mission, MissionEvent

    if not enabled():
        raise SystemExit("Set NOX_ANALYTICS=bigquery (and a GCP project) to backfill.")
    cutoff = datetime.combine(since, datetime.min.time()) if since else datetime(2000, 1, 1)
    counts = {"mission_events": 0, "kb_events": 0}
    async with AsyncSessionLocal() as db:
        missions = {m.id: m for m in (await db.execute(select(Mission))).scalars().all()}
        for ev in (await db.execute(select(MissionEvent).where(MissionEvent.created_at >= cutoff))).scalars().all():
            if (m := missions.get(ev.mission_id)) is not None:
                emit("mission_events", mission_event_row(m, ev))
                counts["mission_events"] += 1
        kbs = {k.id: k for k in (await db.execute(select(KnowledgeBase))).scalars().all()}
        for ev in (await db.execute(select(KBEvent).where(KBEvent.created_at >= cutoff))).scalars().all():
            if (kb := kbs.get(ev.kb_id)) is not None:
                emit("kb_events", kb_event_row(kb, ev))
                counts["kb_events"] += 1
    flush()
    return counts


if __name__ == "__main__":
    import argparse
    import asyncio

    parser = argparse.ArgumentParser(prog="python -m nox_api.services.analytics")
    sub = parser.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("backfill", help="replay stored mission and KB events into BigQuery")
    b.add_argument("--since", type=date.fromisoformat, default=None)
    args = parser.parse_args()
    started = time.monotonic()
    print(json.dumps({**asyncio.run(backfill(args.since)), "seconds": round(time.monotonic() - started, 1)}))
