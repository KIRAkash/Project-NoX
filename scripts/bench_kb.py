"""Benchmark a knowledge-base build: the classic pipeline against NoX's agent team, on the same snapshot.

    cd apps/api && uv run python ../../scripts/bench_kb.py <kb-id> [classic|agents|both]
    cd apps/api && uv run python ../../scripts/bench_kb.py <kb-id> --compare linear graph

Copies the KB's archived source snapshot (raw_ingest.txt) into throwaway KB ids, builds each way with the
settings in .env, and prints wall time, model calls, tokens and cache share. Nothing is committed, no PR opened.

`--compare linear graph` builds with the agent team twice, once per NOX_KB_WORKFLOW orchestration, and checks
CP16's bar for making the workflow graph the default: lint errors after review no worse than linear, and calls
and wall time within +15% (the extra review round is the only growth allowed).
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


async def agents(app: str, raw: str, workflow: str | None = None) -> dict:
    from nox_api.agents.linter import run_linter
    from nox_api.ai.agents import kb_builder
    from nox_api.core.config import settings

    ctx = _ctx(app, raw)
    before = settings.NOX_KB_WORKFLOW
    if workflow:
        settings.NOX_KB_WORKFLOW = workflow
    try:
        with telemetry.usage_scope("agents") as u:
            files, amap = await kb_builder.build(ctx, raw, local=False)
        plan = [p.model_dump() for p in amap.pages]
        return {"pipeline": workflow or "agents", "pages": len([p for p in files if "/" in p and not p.startswith(".")]),
                "interfaces": len(amap.interfaces), "lint_errors": len(run_linter(files, plan).errors),
                **u.summary(), "line": u.line()}
    finally:
        settings.NOX_KB_WORKFLOW = before
        clear_kb_checkpoints(ctx.kb_id)


def _row(name: str, r: dict) -> str:
    lint = f"  lint errors {r['lint_errors']:>3}" if "lint_errors" in r else ""
    return (f"  {name:8} {r['pages']:>3} pages  {r['wall']:>6}s  {r['calls']:>3} calls  in {r['input_tokens']:>8,}  "
            f"out {r['output_tokens']:>7,}  cached {r['cached_share']:.0%}{lint}")


async def compare(app: str, raw: str, modes: list[str]) -> None:
    results = {}
    for mode in modes:
        t = time.monotonic()
        r = await agents(app, raw, mode)
        r["wall"] = round(time.monotonic() - t, 1)
        results[mode] = r
        print(_row(mode, r))
    if {"linear", "graph"} <= set(results):
        lin, g = results["linear"], results["graph"]
        ok = {
            "lint errors ≤ linear": g["lint_errors"] <= lin["lint_errors"],
            "calls within +15%": g["calls"] <= lin["calls"] * 1.15,
            "wall time within +15%": g["wall"] <= lin["wall"] * 1.15,
        }
        for check, passed in ok.items():
            print(f"  {'✓' if passed else '✗'} {check}")
        print("  → graph can be the default" if all(ok.values()) else "  → keep NOX_KB_WORKFLOW=linear for now")


async def main(kb_id: str, which: str, modes: list[str] | None = None) -> None:
    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import KnowledgeBase

    async with AsyncSessionLocal() as db:
        kb = await db.get(KnowledgeBase, uuid.UUID(kb_id))
    raw = load_kb_content(kb_id, "raw_ingest.txt")
    if not kb or not raw:
        sys.exit(f"No KB {kb_id} with an archived snapshot")
    print(f"{kb.app_name}: snapshot {len(raw):,} chars")
    if modes:
        await compare(kb.app_name, raw, modes)
        return
    results = []
    for name, fn in (("classic", classic), ("agents", agents)):
        if which in (name, "both"):
            t = time.monotonic()
            r = await fn(kb.app_name, raw)
            r["wall"] = round(time.monotonic() - t, 1)
            results.append(r)
            print(_row(name, r))
    if len(results) == 2:
        c, a = results
        print(f"  → agents: {c['wall'] / max(a['wall'], 0.1):.1f}× faster, "
              f"{1 - a['input_tokens'] / max(c['input_tokens'], 1):.0%} fewer input tokens per build, "
              f"{(c['input_tokens'] / max(c['pages'], 1)) / max(a['input_tokens'] / max(a['pages'], 1), 1):.1f}× fewer per page")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    if "--compare" in sys.argv:
        modes = sys.argv[sys.argv.index("--compare") + 1:] or ["linear", "graph"]
        asyncio.run(main(sys.argv[1], "compare", modes))
    else:
        asyncio.run(main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "both"))
