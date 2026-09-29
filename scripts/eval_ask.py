"""Ask eval: golden questions about the Apex demo apps, scored on grounding, facts and speed.

    cd apps/api && uv run python ../../scripts/eval_ask.py [--only <app>]

Runs the real Ask agent (same tools, same scope rules) against the knowledge bases in the local database. A case
passes when the answer cites at least one of the expected pages and contains every expected fact. Prints one row per
case and a summary. Uses the configured backend (Agent Platform or API key); costs a few cents.
"""

import asyncio
import re
import sys
import time
import uuid
from dataclasses import dataclass

CASES = [
    # (app, question, any of these pages cited, facts that must appear (case-insensitive regex))
    ("mini-auth-service", "Which algorithm signs the login tokens, and why?", ["decisions/jwt-hs256-signing"], [r"HS256"]),
    ("mini-auth-service", "How long is an access token valid by default?", ["entities/auth-domain", "concepts/jwt-authentication-flow"], [r"15\s*min"]),
    ("mini-auth-service", "Which endpoint returns the current user, and how is the token checked?", ["concepts/token-verification-guard", "summaries/api-reference"], [r"/me", r"verify_token"]),
    ("mini-auth-service", "Does the service keep server-side sessions?", ["concepts/stateless-session-pattern"], [r"stateless|no server-side"]),
    ("market-data-gateway", "Which Kafka topics does the gateway consume?", ["concepts/data-lifecycle", "entities/order-book-consumer", "entities/trade-consumer"], [r"nte\.orderbook\.snapshots", r"nte\.trades\.matched"]),
    ("market-data-gateway", "How does a newly connected client get the current order book?", ["concepts/state-hydration", "decisions/redis-l2-state-caching"], [r"redis", r"snapshot"]),
    ("market-data-gateway", "Why are there two consumer groups?", ["decisions/independent-consumer-groups"], [r"group"]),
    ("market-data-gateway", "On which port do WebSocket clients connect?", ["entities/client-manager"], [r"8080"]),
    ("market-data-gateway", "What message types do subscribers receive?", ["concepts/data-lifecycle", "concepts/websocket-broadcasting", "entities/runtime-models"], [r"L2_UPDATE", r"TRADE_TICK"]),
    ("market-data-gateway", "Does the gateway support FIX protocol connections?", [], [r"not|no\b|doesn't|does not"]),  # must admit it
]


@dataclass
class Result:
    app: str
    question: str
    ok: bool
    cited: bool
    facts: bool
    seconds: float
    calls: int
    tools: int
    note: str = ""


async def run_case(app: str, question: str, expect_refs: list[str], facts: list[str], apps: dict[str, str]) -> Result:
    from nox_api.ai.agents import ask

    t = time.monotonic()
    text, refs, usage = "", [], {}
    async for ev in ask.answer(question, home_app=app, apps=apps, role="engineering", user_id="eval",
                               session_id=f"eval-{uuid.uuid4().hex}"):
        if ev["type"] == "done":
            text = ev["text"]
        elif ev["type"] == "citations":
            refs = ev["refs"]
        elif ev["type"] == "usage":
            usage = ev
    cited = not expect_refs or any(f"{app}/{r}" in refs for r in expect_refs)
    have = all(re.search(f, text, re.I) for f in facts)
    missing = [f for f in facts if not re.search(f, text, re.I)]
    return Result(app, question, cited and have, cited, have, round(time.monotonic() - t, 1), usage.get("calls", 0),
                  usage.get("tool_calls", 0), f"missing {missing}" if missing else ("" if cited else f"cited {refs[:3]}"))


async def main(only: str | None) -> None:
    from sqlalchemy import select

    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import KnowledgeBase

    async with AsyncSessionLocal() as db:
        apps = {k.app_name: str(k.id) for k in (await db.execute(select(KnowledgeBase))).scalars().all()}
    results = []
    for app, q, refs, facts in CASES:
        if (only and app != only) or app not in apps:
            continue
        r = await run_case(app, q, refs, facts, apps)
        results.append(r)
        print(f"{'✓' if r.ok else '✗'} {r.seconds:>5}s {r.calls:>2} calls {r.tools:>2} tools  {app}: {q}  {r.note}", flush=True)
    if results:
        passed = sum(r.ok for r in results)
        print(f"\n{passed}/{len(results)} passed · grounded {sum(r.cited for r in results)}/{len(results)} · "
              f"facts {sum(r.facts for r in results)}/{len(results)} · median {sorted(r.seconds for r in results)[len(results) // 2]}s")


if __name__ == "__main__":
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    asyncio.run(main(only))
