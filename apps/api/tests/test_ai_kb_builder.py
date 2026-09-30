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


# ── CP16: the builder as an ADK workflow graph ──────────────────────────────

def _new_ctx(**kw):
    return SimpleNamespace(**{"kb_id": str(uuid.uuid4()), "app_name": "refunds", "org_slug": "apex", "candidate_contracts": [],
                              "commit_sha": "abc1234", **kw})


@pytest.fixture
def ctxs():
    made = []

    def make(**kw):
        made.append(_new_ctx(**kw))
        return made[-1]

    yield make
    for c in made:
        clear_kb_checkpoints(c.kb_id)


def _revises(fake) -> list[str]:
    return [request_text(r) for r in fake.requests if "Revise the page" in request_text(r)]


async def test_graph_and_linear_produce_the_same_bundle(ctxs, monkeypatch):
    from nox_api.core.config import settings

    built = {}
    for mode in ("linear", "graph"):
        monkeypatch.setattr(settings, "NOX_KB_WORKFLOW", mode)
        use_fake(monkeypatch, FakeLlm(responder=responder))
        built[mode] = await kb_builder.build(ctxs(), RAW, local=False)
    (lin, lin_map), (graph, graph_map) = built["linear"], built["graph"]
    assert list(graph) == list(lin)  # same pages, same order
    assert graph == lin
    assert graph_map == lin_map
    assert contracts_from_interfaces("refunds", graph_map.interfaces, graph) == contracts_from_interfaces("refunds", lin_map.interfaces, lin)


async def test_bundle_is_okf_conformant_after_commit_transform(ctxs, monkeypatch):
    from nox_api.agents import okf

    use_fake(monkeypatch, FakeLlm(responder=responder))
    files, _ = await kb_builder.build(ctxs(), RAW, local=False)
    assert not any(v.startswith("---\n") for v in files.values())  # plain Markdown: OKF is applied at commit time
    out = okf.to_okf(files, existing={}, app="refunds", repo_url="https://github.com/apex/kb-refunds", actor="nox/test")
    assert okf.problems(out) == []
    for folder in {p.rsplit("/", 1)[0] for p in out if "/" in p and not p.startswith(".")}:
        assert f"{folder}/index.md" in out
    assert str(okf.split(out["index.md"])[0].get("okf_version")) == "0.2"


async def test_cross_app_links_survive_review(ctxs, monkeypatch):
    contract = {"app_name": "order-matching-engine", "repo_name": "kb-nte-order-matching-engine", "org_slug": "nte",
                "page_path": "summaries/events.md", "anchor_slug": "matched-trades", "identifier": "nte.trades.matched"}
    link = "[[ap:kb-nte-order-matching-engine/summaries/events#matched-trades|order-matching-engine (nte.trades.matched)]]"

    def cross(req):
        seen = request_text(req)
        if "Revise the page" in seen:
            # a real model rewrites the page and loses the woven link, falling back to the bare identifier
            return text("# Ledger\n\nConsumes `nte.trades.matched`.\n\n## Responsibilities\nReverses payments.\n\n## Dependencies\nNone.\n")
        if "entities/ledger.md" in seen.split("Write the page")[-1]:
            return text("# Ledger\n\nConsumes `nte.trades.matched`.\n")  # fails the schema gate → reviewer
        return responder(req)

    fake = use_fake(monkeypatch, FakeLlm(responder=cross))
    files, _ = await kb_builder.build(ctxs(candidate_contracts=[contract]), RAW, local=False)
    assert len(_revises(fake)) == 1
    assert link in _revises(fake)[0]  # synthesis ran before review: the reviewer saw the woven link
    assert "## Responsibilities" in files["entities/ledger.md"]
    assert link in files["entities/ledger.md"]  # …and again after it, so the rewrite didn't lose it
    assert files["entities/ledger.md"].count("[[ap:") == 1


async def test_review_loops_until_clean_then_stops(ctxs, monkeypatch):
    from nox_api.core.config import settings

    attempts = []

    def second_time_lucky(req):
        seen = request_text(req)
        if "Revise the page" in seen:
            attempts.append(seen)
            if len(attempts) == 1:
                return text("# Ledger\n\n## Responsibilities\nReverses payments.\n")  # still missing Dependencies
        return responder(req)

    use_fake(monkeypatch, FakeLlm(responder=second_time_lucky))
    events = []

    async def log(kind, payload):
        events.append((kind, payload))

    files, _ = await kb_builder.build(ctxs(), RAW, log=log, local=False)
    assert len(attempts) == 2 and all("'entities/ledger.md'" in a for a in attempts)
    assert "Dependencies" in attempts[1].split("fix these quality-gate problems")[1].split("The page:")[0]
    assert "## Dependencies" in files["entities/ledger.md"]
    kinds = [k for k, _ in events]
    assert kinds.count("review_started") == 1 and kinds.count("review_round") == 1
    assert dict(events)["review_round"] == {"round": 2, "pages": ["entities/ledger.md"], "message": "Reviewer round 2: fixing 1 page"}
    gates = [p for k, p in events if k == "quality_gate"]
    assert [g["passed"] for g in gates] == [False, False, True]

    # a page that never passes: exactly NOX_REVIEW_ROUNDS attempts, then the last version is kept
    monkeypatch.setattr(settings, "NOX_REVIEW_ROUNDS", 2)
    tries = []

    def never(req):
        seen = request_text(req)
        if "Revise the page" in seen:
            tries.append(seen)
            return text(f"# Ledger\n\nAttempt {len(tries)}.\n")
        return responder(req)

    use_fake(monkeypatch, FakeLlm(responder=never))
    files, _ = await kb_builder.build(ctxs(), RAW, local=False)
    assert len(tries) == 2
    assert "Attempt 2." in files["entities/ledger.md"]


async def test_writer_failure_leaves_placeholder(ctxs, monkeypatch):
    def flaky(req):
        seen = request_text(req)
        if "Write the page" in seen and "refund-policy" in seen.split("Write the page")[-1]:
            raise RuntimeError("model unavailable")
        return responder(req)

    use_fake(monkeypatch, FakeLlm(responder=flaky))
    events = []

    async def log(kind, payload):
        events.append((kind, payload))

    files, _ = await kb_builder.build(ctxs(), RAW, log=log, local=False)
    assert "NoX couldn't write this page in this build" in files["concepts/refund-policy.md"]
    assert files["concepts/refund-policy.md"].startswith("# Approval policy")
    assert sorted(p["path"] for k, p in events if k == "page_compiled") == ["concepts/refund-policy.md", "entities/ledger.md", "summaries/api-spec.md"]
    assert events[-1][0] == "build_usage"


BIG_MAP = MAP.model_copy(update={"pages": [
    {"path": f"concepts/topic-{i}.md", "topic": f"Topic {i}", "source_files": ["src/api.py"]} for i in range(7)
]})


async def test_parallel_writers_respect_concurrency(ctxs, monkeypatch):
    from nox_api.core.config import settings

    from .ai_fakes import SlowFakeLlm

    monkeypatch.setattr(settings, "NOX_MAX_CONCURRENCY", 2)

    def big(req):
        seen = request_text(req)
        if "cartographer" in seen:
            return data(BIG_MAP.model_dump())
        return text("# Topic\n\nSee [[index]].\n")

    fake = use_fake(monkeypatch, SlowFakeLlm(responder=big))
    files, _ = await kb_builder.build(ctxs(), RAW, local=False)
    assert all(f"concepts/topic-{i}.md" in files for i in range(7))
    assert fake.peak == 2  # the six after the warm-up page ran two at a time, never more


async def test_resume_mid_writing(ctxs, monkeypatch):
    from nox_api.services.local_storage import save_checkpoint_json, upload_content

    ctx = ctxs()
    save_checkpoint_json(ctx.kb_id, "architecture_map.json", MAP.model_dump())
    upload_content(ctx.kb_id, "pages/summaries/api-spec.md", "# REST API\n\nWritten by the earlier run.\n")
    fake = use_fake(monkeypatch, FakeLlm(responder=responder))
    files, _ = await kb_builder.build(ctx, RAW, local=False)
    seen = [request_text(r) for r in fake.requests]
    assert not any("cartographer" in s for s in seen)
    written = sorted(s.split("Write the page '")[1].split("'")[0] for s in seen if "Write the page" in s)
    assert written == ["concepts/refund-policy.md", "entities/ledger.md"]
    assert "Written by the earlier run." in files["summaries/api-spec.md"]


async def test_usage_counts_calls_inside_nodes(ctxs, monkeypatch):
    fake = use_fake(monkeypatch, FakeLlm(responder=responder))
    usage = {}

    async def log(kind, payload):
        if kind == "build_usage":
            usage.update(payload)

    await kb_builder.build(ctxs(), RAW, log=log, local=False)
    assert usage["calls"] == len(fake.requests) == 5  # cartographer, three writers, one reviewer fix
    assert usage["input_tokens"] == 500


async def test_graph_emits_node_events_for_the_panel(ctxs, monkeypatch):
    use_fake(monkeypatch, FakeLlm(responder=responder))
    events = []

    async def log(kind, payload):
        events.append((kind, payload))

    await kb_builder.build(ctxs(), RAW, log=log, local=False)
    started = [p["node"] for k, p in events if k == "node_started"]
    finished = [p["node"] for k, p in events if k == "node_finished"]
    assert started == ["warm_cache", "write_pages", "synthesize", "lint_gate", "review", "synthesize", "lint_gate", "finish"]
    assert finished == ["cartographer", *started]
