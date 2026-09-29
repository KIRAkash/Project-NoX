"""Multi-agent KB build: cartographer → parallel page writers (own files only) → reviewer; resumable."""

import uuid
from types import SimpleNamespace

import pytest

from nox_api.agents.contracts import contracts_from_interfaces
from nox_api.ai.agents import kb_builder
from nox_api.ai.schemas import ArchitectureMap
from nox_api.db.models import InterfaceType
from nox_api.services.local_storage import clear_kb_checkpoints, load_checkpoint_json

from .ai_fakes import FakeLlm, data, request_text, text, use_fake

RAW = """
=== SOURCE: https://github.com/apex/refunds ===

--- FILE: src/api.py ---
@app.post("/refunds")
def create_refund(order_id: str): ...

--- FILE: src/ledger.py ---
class Ledger:
    def reverse(self, payment_id): ...

--- FILE: src/events.py ---
publish("order.refunded", payload)

=== SOURCE: https://apex.atlassian.net/wiki/refund-policy ===
Refunds over 500 EUR need a second approver.
"""

MAP = ArchitectureMap(
    summary="# refunds\n\nIssues refunds and reverses ledger entries.",
    components=["API", "Ledger"],
    interfaces=[
        {"kind": "rest", "identifier": "POST /refunds", "direction": "exposes", "description": "create a refund"},
        {"kind": "event", "identifier": "order.refunded", "direction": "exposes"},
        {"kind": "rest", "identifier": "POST /v2/reversals", "direction": "consumes"},
    ],
    pages=[
        {"path": "summaries/api-spec.md", "topic": "REST API", "source_files": ["src/api.py"]},
        {"path": "entities/ledger.md", "topic": "Ledger", "source_files": ["src/ledger.py", "src/events.py"]},
        {"path": "concepts/refund-policy.md", "topic": "Approval policy", "source_files": ["https://apex.atlassian.net/wiki/refund-policy"]},
    ],
)


def responder(req):
    seen = request_text(req)
    if "cartographer" in seen:
        return data(MAP.model_dump())
    if "Revise the page" in seen:
        return text("# Ledger\n\n## Responsibilities\nReverses payments.\n\n## Dependencies\nNone.\n")
    if "entities/ledger.md" in seen.split("Write the page")[-1]:
        return text("# Ledger\n\nReverses payments. See [[summaries/api-spec]].\n")  # missing required sections → reviewer
    if "summaries/api-spec.md" in seen.split("Write the page")[-1]:
        return text("# REST API\n\n`POST /refunds` creates a refund. See [[entities/ledger]].\n")
    return text("# Approval policy\n\nRefunds over 500 EUR need a second approver.\n")


@pytest.fixture
def ctx():
    c = SimpleNamespace(kb_id=str(uuid.uuid4()), app_name="refunds", org_slug="apex", candidate_contracts=[], commit_sha="abc1234")
    yield c
    clear_kb_checkpoints(c.kb_id)


async def test_build_maps_then_writes_each_page_from_its_own_files(ctx, monkeypatch):
    fake = use_fake(monkeypatch, FakeLlm(responder=responder))
    events = []

    async def log(kind, payload):
        events.append(kind)

    files, amap = await kb_builder.build(ctx, RAW, log=log, local=False)

    assert set(files) >= {"index.md", "summaries/api-spec.md", "entities/ledger.md", "concepts/refund-policy.md", "AGENTS.md", "log.md", ".nox/brief.md"}
    assert files["index.md"].startswith("# refunds")
    # grounding: each writer saw only its own files
    writes = [request_text(r) for r in fake.requests if "Write the page" in request_text(r)]
    api_req = next(w for w in writes if "Write the page 'summaries/api-spec.md'" in w)
    assert "create_refund" in api_req and "class Ledger" not in api_req
    ledger_req = next(w for w in writes if "Write the page 'entities/ledger.md'" in w)
    assert "class Ledger" in ledger_req and "order.refunded" in ledger_req and "create_refund" not in ledger_req.split("Source files for this page")[-1]
    assert "second approver" in next(w for w in writes if "refund-policy" in w.split("Write the page")[-1])
    # shared, cacheable prefix: every writer got the same overview + manifest in its system instruction
    assert all("Issues refunds and reverses ledger entries." in w and "[[entities/ledger]]" in w for w in writes)
    # anchors point at the page's real files, full length
    assert "<!-- anchor: src/api.py:L1-L2 sha:abc1234 -->" in files["summaries/api-spec.md"]
    # the reviewer fixed the entity page that failed the schema gate, and only that one
    assert "## Responsibilities" in files["entities/ledger.md"]
    assert sum("Revise the page" in request_text(r) for r in fake.requests) == 1
    assert events[:2] == ["cartographer_started", "plan_ready"] and events[-1] == "build_usage"
    assert load_checkpoint_json(ctx.kb_id, "architecture_map.json")["interfaces"][0]["identifier"] == "POST /refunds"


async def test_build_resumes_from_checkpoints_without_calling_the_model(ctx, monkeypatch):
    use_fake(monkeypatch, FakeLlm(responder=responder))
    first, _ = await kb_builder.build(ctx, RAW, local=False)
    fake = use_fake(monkeypatch, FakeLlm(responder=responder))
    again, _ = await kb_builder.build(ctx, RAW, local=False)
    assert again["summaries/api-spec.md"] == first["summaries/api-spec.md"]
    assert not any("cartographer" in request_text(r) or "Write the page" in request_text(r) for r in fake.requests)


def test_typed_interfaces_become_contracts_on_the_right_page():
    files = {"index.md": "# refunds", "summaries/api-spec.md": "`POST /refunds` creates…", "entities/ledger.md": "emits `order.refunded`"}
    rows = contracts_from_interfaces("refunds", MAP.interfaces, files)
    assert [(r["interface_type"], r["identifier"], r["page_path"]) for r in rows] == [
        (InterfaceType.rest_endpoint, "/refunds", "summaries/api-spec.md"),
        (InterfaceType.event_topic, "order.refunded", "entities/ledger.md"),
    ]  # consumed interfaces aren't registered as this app's contracts


def test_parse_corpus_keeps_code_files_and_documents():
    from nox_api.ai.tools.knowledge import parse_corpus

    corpus = parse_corpus(RAW)
    assert list(corpus) == ["src/api.py", "src/ledger.py", "src/events.py", "https://apex.atlassian.net/wiki/refund-policy"]
