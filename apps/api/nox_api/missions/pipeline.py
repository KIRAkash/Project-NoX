"""A mission's pipeline: the ordered steps it has to pass through, and where it is on them now.

Today every mission type walks the same path — the four seats forward, the build, then the seats
verify in reverse. `pipeline_for()` takes the type so that new seats, or shorter paths for bugs,
can be added later without touching the stage machine's callers. The shape is stored per mission in
the ticket store (`services/tickets.py`), so each ticket carries the path it was given.
"""

from ..db.models import Mission, MissionStage, Role
from .templates import ROLE_ORDER
from .verification import VERIFY_ORDER

SEAT_LABEL = {Role.business: "Business", Role.product: "Product", Role.engineering: "Engineering", Role.developer: "Developer"}


def pipeline_for(mission_type: str) -> list[dict]:
    """The steps a mission of this type goes through, in order."""
    steps = [{"id": r.value, "kind": "seat", "role": r.value, "label": SEAT_LABEL[r]} for r in ROLE_ORDER]
    steps.append({"id": "build", "kind": "build", "role": Role.developer.value, "label": "Build"})
    steps += [{"id": f"verify:{r.value}", "kind": "verify", "role": r.value, "label": f"{SEAT_LABEL[r]} verifies"} for r in VERIFY_ORDER]
    return steps


def current_step(mission: Mission) -> str | None:
    """The step the mission is on; None once it is done."""
    if mission.stage == MissionStage.done:
        return None
    if mission.stage == MissionStage.verifying:
        return f"verify:{(mission.verify_role or VERIFY_ORDER[0]).value}"
    return mission.stage.value


def pipeline_state(mission: Mission, steps: list[dict] | None = None) -> list[dict]:
    """Each step marked done, current or pending. A send-back moves the current step back again."""
    steps = steps or pipeline_for(mission.type)
    now = current_step(mission)
    ids = [s["id"] for s in steps]
    at = ids.index(now) if now in ids else len(ids)
    return [{**s, "status": "done" if i < at else "current" if i == at else "pending"} for i, s in enumerate(steps)]
