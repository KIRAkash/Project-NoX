"""Ticket state in Firestore: who a mission is assigned to, and where it is on its pipeline.

One document per mission, `missions/NOX-n`:

    key, orgId, title, type, stage, verifyRole
    currentStep   the pipeline step it is on (None once done)
    pipeline      [{id, kind, role, label, status: done|current|pending}] — the path this ticket was given
    transitions   [{from, to, event, by, at}] — every time the current step moved, forward or back
    assignee      {userId, name, email, photoUrl, assignedBy, assignedAt} or null
    updatedAt

Postgres stays the record for spec files and the stage machine; this document is the ticket's
state as people see it. The assignee lives only here. Pipeline fields are written from
`missions/events.record()` whenever the current step moves, best-effort: a Firestore outage never
blocks a save or an approval.

`NOX_TICKET_STORE=firestore` uses Cloud Firestore (project from FIREBASE_PROJECT_ID, credentials from
FIREBASE_SERVICE_ACCOUNT_PATH or the service's own identity). Anything else keeps the documents in
memory, for tests and local runs without Google Cloud.
"""

import asyncio
import logging
from datetime import UTC, datetime
from typing import Protocol

from ..core.config import settings
from ..db.models import Mission
from ..missions.pipeline import current_step, pipeline_for, pipeline_state

logger = logging.getLogger(__name__)

COLLECTION = "missions"


class TicketStore(Protocol):
    async def get(self, key: str) -> dict | None: ...
    async def merge(self, key: str, fields: dict, transition: dict | None = None) -> None: ...


class MemoryTicketStore:
    def __init__(self) -> None:
        self.docs: dict[str, dict] = {}

    async def get(self, key: str) -> dict | None:
        doc = self.docs.get(key)
        return {**doc, "transitions": list(doc.get("transitions", []))} if doc else None

    async def merge(self, key: str, fields: dict, transition: dict | None = None) -> None:
        doc = self.docs.setdefault(key, {})
        doc.update(fields)
        if transition:
            doc.setdefault("transitions", []).append(transition)


class FirestoreTicketStore:
    def __init__(self) -> None:
        from google.cloud import firestore

        from ..core.auth import firebase_project_id

        creds = None
        if settings.FIREBASE_SERVICE_ACCOUNT_PATH:
            from google.oauth2 import service_account

            creds = service_account.Credentials.from_service_account_file(settings.FIREBASE_SERVICE_ACCOUNT_PATH)
        project = firebase_project_id() or settings.GOOGLE_CLOUD_PROJECT or settings.GCP_PROJECT_ID or None
        self._fs = firestore
        self.client = firestore.AsyncClient(project=project, credentials=creds, database=settings.FIRESTORE_DATABASE)

    async def get(self, key: str) -> dict | None:
        snap = await self.client.collection(COLLECTION).document(key).get()
        return snap.to_dict() if snap.exists else None

    async def merge(self, key: str, fields: dict, transition: dict | None = None) -> None:
        data = dict(fields)
        if transition:
            data["transitions"] = self._fs.ArrayUnion([transition])
        # Replace each named field whole (a new assignee must not inherit the old one's keys).
        await self.client.collection(COLLECTION).document(key).set(data, merge=list(data))


_store: TicketStore | None = None


def store() -> TicketStore:
    global _store
    if _store is None:
        _store = FirestoreTicketStore() if settings.NOX_TICKET_STORE.lower() == "firestore" else MemoryTicketStore()
    return _store


def reset_store() -> None:
    global _store
    _store = None


# ── Pipeline sync ────────────────────────────────────────────────────────────

# Events that can move the stage. They are recorded by the missions router on a freshly loaded mission;
# background jobs (drafting, Git, Jira) hold older copies and must not write a stale position back.
STAGE_EVENTS = {"mission.created", "file.saved", "file.approved", "mission.sent_back", "mission.completed",
                "verify.verified", "verify.not_met", "mission.updated"}


async def sync_pipeline(mission: Mission, event: str, by: str | None = None, force: bool = False) -> dict:
    """Write the mission's pipeline position; append a transition when the current step moved."""
    key, now = mission.key, current_step(mission)
    doc = await store().get(key)
    if doc and not force and doc.get("currentStep") == now:
        return doc
    steps = [{k: v for k, v in s.items() if k != "status"} for s in doc["pipeline"]] if doc and doc.get("pipeline") else pipeline_for(mission.type)
    at = datetime.now(UTC)
    moved = doc is None or doc.get("currentStep") != now
    fields = {
        "key": key,
        "orgId": str(mission.org_id),
        "title": mission.title,
        "type": mission.type,
        "stage": mission.stage.value,
        "verifyRole": mission.verify_role.value if mission.verify_role else None,
        "currentStep": now,
        "pipeline": pipeline_state(mission, steps),
        "updatedAt": at,
    }
    if doc is None:
        fields["assignee"] = None
    transition = {"from": doc.get("currentStep") if doc else None, "to": now, "event": event, "by": by or "NoX", "at": at} if moved else None
    await store().merge(key, fields, transition)
    return {**(doc or {}), **fields, "transitions": [*(doc or {}).get("transitions", []), *([transition] if transition else [])]}


async def sync_pipeline_quietly(mission: Mission, event: str, by: str | None = None) -> None:
    """Best-effort version for the event path: logs and moves on if Firestore is slow or down."""
    if event not in STAGE_EVENTS:
        return
    try:
        await asyncio.wait_for(sync_pipeline(mission, event, by, force=event == "mission.updated"), timeout=5)
    except Exception as e:
        logger.warning("ticket state for %s not written: %s", mission.key, e)


async def ticket_state(mission: Mission) -> dict:
    """The ticket document, created on first read for missions that predate it."""
    doc = await store().get(mission.key)
    return doc if doc and doc.get("pipeline") else await sync_pipeline(mission, "state.backfilled", force=True)


async def set_assignee(mission: Mission, assignee: dict | None) -> dict:
    await ticket_state(mission)  # make sure the pipeline fields exist alongside the assignee
    await store().merge(mission.key, {"assignee": assignee, "updatedAt": datetime.now(UTC)})
    return await store().get(mission.key) or {}
