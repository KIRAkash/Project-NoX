"""Benchmark a knowledge-base build: the classic pipeline against NoX's agent team, on the same snapshot.

    cd apps/api && uv run python ../../scripts/bench_kb.py <kb-id> [classic|agents|both]

Copies the KB's archived source snapshot (raw_ingest.txt) into throwaway KB ids, builds each way with the
settings in .env, and prints wall time, model calls, tokens and cache share. Nothing is committed, no PR opened.
"""

import asyncio
import sys
import time
import uuid
from types import SimpleNamespace

from nox_api.ai import telemetry
from nox_api.services.local_storage import clear_kb_checkpoints, load_kb_content, upload_content


def _ctx(app: str, raw: str) -> SimpleNamespace:
    kb_id = str(uuid.uuid4())
    upload_content(kb_id, "raw_ingest.txt", raw)
    return SimpleNamespace(kb_id=kb_id, app_name=app, org_slug="bench", org_id="", raw_content="", ingested_content="",
                           candidate_contracts=[], compiled_files=None, affected_files=None, decision="none", commit_sha="")


async def classic(app: str, raw: str) -> dict:
    from nox_api.agents.compiler import run_compiler
    from nox_api.agents.ingestor import run_ingestor

    ctx = _ctx(app, raw)
    try:
        with telemetry.usage_scope("classic") as u:
            ctx.ingested_content, ctx.raw_content = await run_ingestor(ctx, [], {})
            files = await run_compiler(ctx)
        return {"pipeline": "classic", "pages": len([p for p in files if "/" in p and not p.startswith(".")]), **u.summary(), "line": u.line()}
    finally:
        clear_kb_checkpoints(ctx.kb_id)


async def agents(app: str, raw: str) -> dict:
    from nox_api.ai.agents import kb_builder

    ctx = _ctx(app, raw)
    try:
        with telemetry.usage_scope("agents") as u:
            files, amap = await kb_builder.build(ctx, raw, local=False)
        return {"pipeline": "agents", "pages": len([p for p in files if "/" in p and not p.startswith(".")]),
                "interfaces": len(amap.interfaces), **u.summary(), "line": u.line()}
    finally:
        clear_kb_checkpoints(ctx.kb_id)


async def main(kb_id: str, which: str) -> None:
    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import KnowledgeBase

    async with AsyncSessionLocal() as db:
        kb = await db.get(KnowledgeBase, uuid.UUID(kb_id))
    raw = load_kb_content(kb_id, "raw_ingest.txt")
    if not kb or not raw:
        sys.exit(f"No KB {kb_id} with an archived snapshot")
    print(f"{kb.app_name}: snapshot {len(raw):,} chars")
    results = []
    for name, fn in (("classic", classic), ("agents", agents)):
        if which in (name, "both"):
            t = time.monotonic()
            r = await fn(kb.app_name, raw)
            r["wall"] = round(time.monotonic() - t, 1)
            results.append(r)
            print(f"  {name:8} {r['pages']:>3} pages  {r['wall']:>6}s  {r['calls']:>3} calls  in {r['input_tokens']:>8,}  "
                  f"out {r['output_tokens']:>7,}  cached {r['cached_share']:.0%}")
    if len(results) == 2:
        c, a = results
        print(f"  → agents: {c['wall'] / max(a['wall'], 0.1):.1f}× faster, "
              f"{1 - a['input_tokens'] / max(c['input_tokens'], 1):.0%} fewer input tokens per build, "
              f"{(c['input_tokens'] / max(c['pages'], 1)) / max(a['input_tokens'] / max(a['pages'], 1), 1):.1f}× fewer per page")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    asyncio.run(main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "both"))
