"""Knowledge-base search: pages split by section, ranked by meaning and by words together.

Indexing (after every build or sync) splits each page at its `##` headings into chunks of a few hundred
tokens and embeds only the chunks whose text changed since last time, so a sync that touches two pages
re-embeds a handful of chunks. Only compiled KB markdown is embedded, never raw source.

Searching fuses two rankings with reciprocal rank fusion:
  - vector: `gemini-embedding-2` (768 dims, pgvector cosine) — finds "refunds" when the page says "reversal"
  - full-text: Postgres tsvector — exact identifiers like `order.refunded` or `POST /refund`
Without pgvector or with NOX_EMBEDDINGS=false it runs on full-text alone; callers fall back to keyword
ranking if a knowledge base hasn't been indexed yet.

    python -m nox_api.services.search backfill    index every knowledge base that has compiled files
"""

from __future__ import annotations

import hashlib
import logging
import re
import uuid
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai import telemetry
from ..core.config import settings

logger = logging.getLogger(__name__)

CHUNK_CHARS = 2400          # ~600 tokens
MIN_CHUNK_CHARS = 300       # smaller sections merge into the previous one
RRF_K = 60
CANDIDATES = 40
SKIP = ("AGENTS.md", "log.md")


# ── Chunking ────────────────────────────────────────────────────────────────

@dataclass
class Chunk:
    path: str
    idx: int
    heading: str
    content: str

    @property
    def hash(self) -> str:
        return hashlib.sha256(f"{self.path}\n{self.heading}\n{self.content}".encode()).hexdigest()


def _clean(md: str) -> str:
    md = re.sub(r"<!--.*?-->", "", md, flags=re.S)  # anchors and other comments
    md = re.sub(r"^---\n.*?\n---\n", "", md, flags=re.S)  # front matter
    return md.strip()


def _split_long(body: str) -> list[str]:
    if len(body) <= CHUNK_CHARS:
        return [body]
    out, cur = [], ""
    for para in re.split(r"\n{2,}", body):
        if cur and len(cur) + len(para) + 2 > CHUNK_CHARS:
            out.append(cur)
            cur = ""
        cur = f"{cur}\n\n{para}" if cur else para
        while len(cur) > CHUNK_CHARS:  # one enormous paragraph (e.g. a code block)
            out.append(cur[:CHUNK_CHARS])
            cur = cur[CHUNK_CHARS:]
    if cur:
        out.append(cur)
    return out


def chunk_page(path: str, markdown: str) -> list[Chunk]:
    """Split a page at `##` headings; tiny sections merge into the one before, huge ones split on paragraphs."""
    body = _clean(markdown)
    if not body:
        return []
    sections: list[tuple[str, str]] = []
    title = ""
    heading, buf = "", []
    for line in body.splitlines():
        m = re.match(r"^(#{1,3})\s+(.*)", line)
        if m and len(m.group(1)) == 1 and not title:
            title = m.group(2).strip()
        if m and len(m.group(1)) in (2, 3) and "\n".join(buf).strip():
            sections.append((heading, "\n".join(buf).strip()))
            buf = []
        if m and len(m.group(1)) in (2, 3):
            heading = m.group(2).strip()
        buf.append(line)
    if "\n".join(buf).strip():
        sections.append((heading, "\n".join(buf).strip()))

    if len(sections) > 1 and len(sections[0][1]) < MIN_CHUNK_CHARS:  # a lone title/intro joins the first section
        sections[1] = (sections[0][0], sections[0][1] + "\n\n" + sections[1][1])
        sections.pop(0)

    merged: list[tuple[str, str]] = []
    for h, content in sections:
        if merged and len(content) < MIN_CHUNK_CHARS and len(merged[-1][1]) + len(content) <= CHUNK_CHARS:
            merged[-1] = (merged[-1][0], merged[-1][1] + "\n\n" + content)
        else:
            merged.append((h, content))

    chunks, idx = [], 0
    for h, content in merged:
        for piece in _split_long(content):
            chunks.append(Chunk(path=path, idx=idx, heading=h or title, content=piece))
            idx += 1
    return chunks


def chunk_kb(files: dict[str, str]) -> list[Chunk]:
    out = []
    for path, md in sorted(files.items()):
        if not path.endswith(".md") or path.startswith(".") or path in SKIP:
            continue
        out.extend(chunk_page(path, md or ""))
    return out


# ── Capabilities ────────────────────────────────────────────────────────────

_has_vector: bool | None = None


async def has_vector(db: AsyncSession) -> bool:
    global _has_vector
    if _has_vector is None:
        _has_vector = bool((await db.execute(text(
            "SELECT 1 FROM information_schema.columns WHERE table_name = 'kb_chunks' AND column_name = 'embedding'"
        ))).first())
    return _has_vector


def embeddings_on() -> bool:
    from ..ai.config import backend

    return settings.NOX_EMBEDDINGS and backend() != "local"


def _vec(values: list[float]) -> str:
    return "[" + ",".join(f"{v:.7f}" for v in values) + "]"


async def embed(texts: list[str], task: str) -> list[list[float]]:
    """Embed in batches on the configured backend (Agent Platform or API key)."""
    from google.genai import types

    from ..ai.config import genai_client

    client = genai_client()
    out: list[list[float]] = []
    for i in range(0, len(texts), 50):
        batch = texts[i:i + 50]
        cfg = types.EmbedContentConfig(task_type=task, output_dimensionality=settings.NOX_EMBED_DIM)
        resp = await client.aio.models.embed_content(model=settings.NOX_EMBED_MODEL, contents=batch, config=cfg)
        out.extend(e.values for e in resp.embeddings)
        telemetry.record_embedding(sum(len(t) for t in batch) // 4)
    return out


# ── Indexing ────────────────────────────────────────────────────────────────

@dataclass
class IndexStats:
    chunks: int = 0
    embedded: int = 0
    removed: int = 0
    unchanged: int = 0


@dataclass
class IndexPlan:
    stale: list[tuple[str, int]]     # rows whose section no longer exists
    to_write: list[Chunk]            # new or changed text
    to_embed: list[Chunk]            # needs a (new) vector
    unchanged: int


def plan_index(existing: dict[tuple[str, int], tuple[str, str | None]], chunks: list[Chunk], vector: bool, model: str) -> IndexPlan:
    """Diff stored chunks (hash, embedded_with) against fresh ones: write changed text, embed only what changed."""
    wanted = {(c.path, c.idx) for c in chunks}
    plan = IndexPlan(stale=[k for k in existing if k not in wanted], to_write=[], to_embed=[], unchanged=0)
    for c in chunks:
        old = existing.get((c.path, c.idx))
        if old and old[0] == c.hash:
            if vector and old[1] != model:  # same text, missing or outdated vector
                plan.to_embed.append(c)
            else:
                plan.unchanged += 1
            continue
        plan.to_write.append(c)
        if vector:
            plan.to_embed.append(c)
    return plan


async def index_kb(db: AsyncSession, kb_id, org_id, app_name: str, files: dict[str, str]) -> IndexStats:
    """Bring a knowledge base's chunks in line with `files`; embed only new or changed chunks."""
    kb_id = uuid.UUID(str(kb_id))
    chunks = chunk_kb(files)
    stats = IndexStats(chunks=len(chunks))
    vector = await has_vector(db) and embeddings_on()
    model = settings.NOX_EMBED_MODEL

    rows = (await db.execute(text("SELECT path, idx, content_hash, embedded_with FROM kb_chunks WHERE kb_id = :kb"),
                             {"kb": kb_id})).all()
    plan = plan_index({(r.path, r.idx): (r.content_hash, r.embedded_with) for r in rows}, chunks, vector, model)
    stats.removed, stats.unchanged = len(plan.stale), plan.unchanged
    to_embed = plan.to_embed

    for path, idx in plan.stale:
        await db.execute(text("DELETE FROM kb_chunks WHERE kb_id = :kb AND path = :p AND idx = :i"), {"kb": kb_id, "p": path, "i": idx})
    clear_vector = ", embedding = NULL" if await has_vector(db) else ""
    for c in plan.to_write:
        await db.execute(text(
            "INSERT INTO kb_chunks (kb_id, org_id, app_name, path, idx, heading, content, content_hash, tokens) "
            "VALUES (:kb, :org, :app, :p, :i, :h, :c, :hash, :t) "
            "ON CONFLICT (kb_id, path, idx) DO UPDATE SET heading = EXCLUDED.heading, content = EXCLUDED.content, "
            "content_hash = EXCLUDED.content_hash, tokens = EXCLUDED.tokens, app_name = EXCLUDED.app_name, embedded_with = NULL"
            + clear_vector
        ), {"kb": kb_id, "org": uuid.UUID(str(org_id)) if org_id else None, "app": app_name, "p": c.path, "i": c.idx,
            "h": c.heading[:300], "c": c.content, "hash": c.hash, "t": len(c.content) // 4})
    await db.commit()

    if to_embed:
        try:
            vectors = await embed([f"{c.heading}\n\n{c.content}" for c in to_embed], "RETRIEVAL_DOCUMENT")
            for c, v in zip(to_embed, vectors, strict=True):
                await db.execute(text(
                    "UPDATE kb_chunks SET embedding = CAST(:v AS vector), embedded_with = :m "
                    "WHERE kb_id = :kb AND path = :p AND idx = :i"
                ), {"v": _vec(v), "m": model, "kb": kb_id, "p": c.path, "i": c.idx})
            await db.commit()
            stats.embedded = len(to_embed)
        except Exception as e:  # search still works on full-text; the next index run retries
            await db.rollback()
            logger.warning(f"Embedding {len(to_embed)} chunks for {app_name} failed: {e}")
    logger.info(f"Indexed {app_name}: {stats}")
    return stats


async def index_kb_safely(kb_id, files: dict[str, str]) -> IndexStats | None:
    """Index in its own session; a search-index failure never fails a knowledge-base build."""
    from ..db.database import AsyncSessionLocal
    from ..db.models import KnowledgeBase

    try:
        async with AsyncSessionLocal() as db:
            kb = await db.get(KnowledgeBase, uuid.UUID(str(kb_id)))
            if not kb:
                return None
            return await index_kb(db, kb.id, kb.org_id, kb.app_name, files)
    except Exception as e:
        logger.warning(f"Search indexing failed for KB {kb_id}: {e}")
        return None


# ── Searching ───────────────────────────────────────────────────────────────

@dataclass
class Hit:
    kb_id: str
    app_name: str
    path: str
    heading: str
    content: str        # the best-matching section
    score: float

    @property
    def ref(self) -> str:
        return f"{self.app_name}/{self.path.removesuffix('.md')}"


_STOP = set("the a an and or of to in on for with is are be as at by it this that from can we our so do does not how what which who why where when".split())


def _tsquery(query: str) -> str:
    """OR of the query's words (prefix-matched): recall first, ranking sorts it out."""
    terms = [t for t in re.findall(r"[a-z0-9_]{2,}", query.lower()) if t not in _STOP]
    return " | ".join(f"{t}:*" for t in dict.fromkeys(terms))[:1000]


def fuse(rankings: list[list[str]], k: int = RRF_K) -> dict[str, float]:
    """Reciprocal rank fusion: score = Σ 1 / (k + rank) over every ranking an item appears in."""
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, item in enumerate(ranking, start=1):
            scores[item] = scores.get(item, 0.0) + 1.0 / (k + rank)
    return scores


async def search(db: AsyncSession, query: str, kb_ids: list, k: int = 8) -> list[Hit]:
    """The `k` best pages for `query` across `kb_ids`, each with its best-matching section."""
    ids = [uuid.UUID(str(i)) for i in kb_ids]
    if not ids or not query.strip():
        return []

    rows: dict[str, object] = {}
    rankings: list[list[str]] = []

    tsq = _tsquery(query)
    if tsq:
        # Rank by how many of the query's words a section matches first (coordination), then by ts_rank_cd:
        # otherwise one match in a heavily weighted title beats a section that matches the whole question.
        terms = tsq.split(" | ")[:12]
        coverage = " + ".join(f"(tsv @@ to_tsquery('english', :t{i}))::int" for i in range(len(terms)))
        fts = (await db.execute(text(
            "SELECT id, kb_id, app_name, path, heading, content FROM kb_chunks "
            "WHERE kb_id = ANY(:ids) AND tsv @@ to_tsquery('english', :q) "
            f"ORDER BY ({coverage}) DESC, ts_rank_cd(tsv, to_tsquery('english', :q)) DESC LIMIT :n"
        ), {"ids": ids, "q": tsq, "n": CANDIDATES, **{f"t{i}": t for i, t in enumerate(terms)}})).all()
        rankings.append([str(r.id) for r in fts])
        rows.update({str(r.id): r for r in fts})

    if await has_vector(db) and embeddings_on():
        try:
            [qv] = await embed([query], "RETRIEVAL_QUERY")
            vec = (await db.execute(text(
                "SELECT id, kb_id, app_name, path, heading, content FROM kb_chunks "
                "WHERE kb_id = ANY(:ids) AND embedding IS NOT NULL "
                "ORDER BY embedding <=> CAST(:v AS vector) LIMIT :n"
            ), {"ids": ids, "v": _vec(qv), "n": CANDIDATES})).all()
            rankings.append([str(r.id) for r in vec])
            rows.update({str(r.id): r for r in vec})
        except Exception as e:
            logger.warning(f"Vector search unavailable, using full-text only: {e}")

    scores = fuse(rankings)
    pages: dict[tuple[str, str], Hit] = {}
    for cid, score in sorted(scores.items(), key=lambda x: -x[1]):
        r = rows[cid]
        key = (str(r.kb_id), r.path)
        if key in pages:
            pages[key].score += score * 0.5  # more matching sections: a little more relevant, never dominant
            continue
        pages[key] = Hit(kb_id=str(r.kb_id), app_name=r.app_name, path=r.path, heading=r.heading, content=r.content, score=score)
    return sorted(pages.values(), key=lambda h: -h.score)[:k]


async def ensure_vector_column(db: AsyncSession) -> bool:
    """Add the embedding column if pgvector became available after the migration ran (local dev)."""
    global _has_vector
    if await has_vector(db):
        return True
    try:
        await db.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await db.execute(text(f"ALTER TABLE kb_chunks ADD COLUMN IF NOT EXISTS embedding vector({settings.NOX_EMBED_DIM})"))
        await db.execute(text("CREATE INDEX IF NOT EXISTS ix_kb_chunks_embedding ON kb_chunks USING hnsw (embedding vector_cosine_ops)"))
        await db.commit()
        _has_vector = True
    except Exception as e:
        await db.rollback()
        print(f"pgvector not available ({type(e).__name__}); indexing for full-text search only")
    return bool(_has_vector)


async def backfill() -> None:
    from sqlalchemy import select

    from ..db.database import AsyncSessionLocal
    from ..db.models import KnowledgeBase
    from .local_storage import load_checkpoint_json

    async with AsyncSessionLocal() as db:
        await ensure_vector_column(db)
        kbs = (await db.execute(select(KnowledgeBase))).scalars().all()
    with telemetry.usage_scope("embed-backfill") as usage:
        for kb in kbs:
            files = load_checkpoint_json(str(kb.id), "compiled_files.json") or {}
            if files:
                stats = await index_kb_safely(kb.id, files)
                print(f"{kb.app_name}: {stats}")
    print(f"embedded ~{usage.embedded_tokens} tokens")


if __name__ == "__main__":
    import asyncio
    import sys

    if sys.argv[1:] == ["backfill"]:
        asyncio.run(backfill())
    else:
        print(__doc__)
