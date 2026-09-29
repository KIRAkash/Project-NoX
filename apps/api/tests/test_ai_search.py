"""KB search: section chunking, embed-only-what-changed, rank fusion, scoping, and the keyword fallback."""

import pytest

from nox_api.services import search
from nox_api.services.local_storage import clear_kb_checkpoints, save_checkpoint_json
from nox_api.services.search import Chunk, chunk_kb, chunk_page, fuse, plan_index

PAGES = {
    "entities/refund.md": "<!-- anchor: src/refund.py#L1-L90 -->\n# Refund\n\nA refund reverses a settled payment.\n\n"
                          "## Responsibilities\n\nEmits `order.refunded` after the ledger entry is written.\n\n"
                          "## Dependencies\n\nCalls the payments gateway `POST /v2/reversals`.\n",
    "concepts/login-flow.md": "# Login flow\n\nPasswords are checked in src/auth.py. Lockout counters live in memory.\n",
    "AGENTS.md": "# Agent contract\n\nnot searchable",
    ".nox/brief.md": "digest, not searchable",
}


def test_chunks_follow_sections_and_skip_non_pages():
    chunks = chunk_kb(PAGES)
    assert {c.path for c in chunks} == {"entities/refund.md", "concepts/login-flow.md"}
    refund = [c for c in chunks if c.path == "entities/refund.md"]
    # tiny sections merge into the previous one; anchors are stripped
    assert all("anchor:" not in c.content for c in refund)
    assert "order.refunded" in "".join(c.content for c in refund) and refund[0].heading == "Refund"


def test_long_sections_split_on_paragraphs_under_the_budget():
    body = "# Big\n\n## Section\n\n" + "\n\n".join(f"Paragraph {i} " + "word " * 120 for i in range(12))
    chunks = chunk_page("summaries/big.md", body)
    assert len(chunks) > 2
    assert all(len(c.content) <= search.CHUNK_CHARS for c in chunks)
    assert [c.idx for c in chunks] == list(range(len(chunks))) and {c.heading for c in chunks} == {"Big"}


def test_plan_embeds_only_new_or_changed_sections():
    a, b = Chunk("p.md", 0, "A", "alpha"), Chunk("p.md", 1, "B", "beta")
    first = plan_index({}, [a, b], vector=True, model="m1")
    assert first.to_write == [a, b] and first.to_embed == [a, b]

    stored = {("p.md", 0): (a.hash, "m1"), ("p.md", 1): (b.hash, "m1"), ("gone.md", 0): ("x", "m1")}
    b2 = Chunk("p.md", 1, "B", "beta, edited")
    second = plan_index(stored, [a, b2], vector=True, model="m1")
    assert second.to_write == [b2] and second.to_embed == [b2] and second.unchanged == 1
    assert second.stale == [("gone.md", 0)]

    # a new embedding model re-embeds unchanged text without rewriting it
    third = plan_index({("p.md", 0): (a.hash, "m1")}, [a], vector=True, model="m2")
    assert third.to_write == [] and third.to_embed == [a]
    # without pgvector nothing is embedded
    assert plan_index({}, [a], vector=False, model="m1").to_embed == []


def test_rank_fusion_rewards_agreement():
    scores = fuse([["x", "y", "z"], ["y", "w"]])
    assert max(scores, key=scores.get) == "y"
    assert scores["x"] > scores["w"]  # first place in one ranking beats second place in another


def test_tsquery_keeps_identifiers_and_drops_noise():
    assert search._tsquery("How does order.refunded get emitted?") == "order:* | refunded:* | get:* | emitted:*"
    assert search._tsquery("the and of") == ""


@pytest.fixture
async def indexed_kb(db_clean, monkeypatch):
    from tests.test_missions import _setup_app

    monkeypatch.setattr(search, "embeddings_on", lambda: False)  # full-text path: no network in tests
    kb = await _setup_app()
    save_checkpoint_json(kb, "compiled_files.json", PAGES)
    stats = await search.index_kb_safely(kb, PAGES)
    yield kb, stats
    clear_kb_checkpoints(kb)


async def test_index_then_search_by_identifier_and_meaningful_words(indexed_kb):
    from nox_api.db.database import AsyncSessionLocal

    kb, stats = indexed_kb
    assert stats.chunks == 2 and stats.removed == 0
    async with AsyncSessionLocal() as db:
        hits = await search.search(db, "which event is emitted after a refund?", [kb])
        assert hits[0].path == "entities/refund.md" and "order.refunded" in hits[0].content
        assert hits[0].ref == "refunds-service/entities/refund"
        assert (await search.search(db, "lockout counters", [kb]))[0].path == "concepts/login-flow.md"
        assert await search.search(db, "refund", []) == []  # nothing visible, nothing found


async def test_reindex_is_incremental(indexed_kb):
    kb, _ = indexed_kb
    again = await search.index_kb_safely(kb, PAGES)
    assert again.unchanged == again.chunks and again.removed == 0
    fewer = {k: v for k, v in PAGES.items() if k != "concepts/login-flow.md"}
    after = await search.index_kb_safely(kb, fewer)
    assert after.removed == 1


async def test_cli_search_uses_the_index(indexed_kb):
    from tests.test_missions import _client

    async with _client("developer") as dev:
        hits = (await dev.get("/api/v1/cli/kb/search", params={"q": "reversals gateway"})).json()
    assert hits[0]["ref"] == "refunds-service/entities/refund"
    assert "reversals" in hits[0]["snippet"]
