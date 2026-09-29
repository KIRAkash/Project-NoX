"""Show NoX eval: golden captures of the Apex trade desk, scored on grounding.

    cd apps/api && uv run python ../../scripts/eval_media.py [--dir <captures folder>]

Runs the real Perceive and Ground stages (same prompts, same tools, same scope rules as `missions/media.py`) on each
capture against the knowledge bases in the local database. A case passes when the expected application is ranked
first, at least one cited page matches an expected ref, and at least one code location matches an expected path.

The captures are recordings of `demo/screens/trade-desk.html` and live in `demo/screens/captures/` (not in Git: they
are large). A missing file is skipped, not failed. Uses the configured backend; costs a few cents per capture.
"""

import asyncio
import re
import sys
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CAPTURES = ROOT / "demo" / "screens" / "captures"

CASES = [
    # (file, kind, mime, duration_s, caption, first app, any of these refs cited (regex), any of these paths found (regex))
    ("trade-desk-pending.webm", "screen_recording", "video/webm", 45,
     None,
     "trade-settlement-system", [r"settlement", r"event-driven", r"adr-002"],
     [r"TradeMatchedListener\.java", r"SettlementStatusPublisher\.java", r"application\.yml"]),
    ("trade-desk-blotter.png", "screenshot", "image/png", None,
     "Why is T-40816 still Pending settlement when the other fill SETTLED?",
     "trade-settlement-system", [r"settlement"],
     [r"TradeMatchedListener\.java", r"SettlementStatusPublisher\.java"]),
    ("trade-desk-iceberg.webm", "audio", "audio/webm", 30,
     None,
     "trade-settlement-system", [r"settlement", r"iceberg", r"trade"],
     [r"TradeMatchedListener\.java", r"order\.go", r"trade\.go"]),
]


@dataclass
class Result:
    file: str
    ok: bool
    ranked: bool
    cited: bool
    found: bool
    seconds: float
    note: str = ""


async def run_case(path: Path, kind: str, mime: str, duration: float | None, caption: str | None, app: str,
                   refs: list[str], paths: list[str], apps: dict[str, str]) -> Result:
    from nox_api.db.models import MediaAsset, MediaKind, MediaStatus, Role
    from nox_api.missions import media

    m = MediaAsset(id=uuid.uuid4(), kind=MediaKind(kind), mime=mime, bytes=path.stat().st_size, duration_s=duration,
                   storage_uri=f"local://{path}", caption=caption, uploaded_as=Role.developer,
                   status=MediaStatus.analyzing)
    t = time.monotonic()
    obs = await media.perceive(m, original=None, request=caption)
    g = await media.ground(m, obs, apps=apps, home_app="", request=caption)
    first = g.apps[0].app if g.apps else None
    ranked = first == app
    cited = any(re.search(r, f.ref, re.I) for f in g.findings for r in refs)
    found = any(re.search(p, c.location) for c in g.code for p in paths)
    note = "" if ranked else f"first app {first}"
    if not cited:
        note += f" cited {[f.ref for f in g.findings][:3]}"
    if not found:
        note += f" code {[c.location for c in g.code][:3]}"
    return Result(path.name, ranked and cited and found, ranked, cited, found, round(time.monotonic() - t, 1), note.strip())


async def main(folder: Path) -> None:
    from sqlalchemy import select

    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import KnowledgeBase
    from nox_api.missions import media

    async def quiet(m, type_, payload=None):  # no SSE listeners here; print the live steps instead
        if type_ == "media.step":
            print(f"    · {payload['label']}", flush=True)

    media._emit = quiet
    async with AsyncSessionLocal() as db:
        apps = {k.app_name: str(k.id) for k in (await db.execute(select(KnowledgeBase))).scalars().all()}
    results = []
    for file, kind, mime, duration, caption, app, refs, paths in CASES:
        path = folder / file
        if not path.exists():
            print(f"- skipped {file} (no capture at {path})")
            continue
        if app not in apps:
            print(f"- skipped {file} ({app} has no knowledge base here)")
            continue
        r = await run_case(path, kind, mime, duration, caption, app, refs, paths, apps)
        results.append(r)
        print(f"{'✓' if r.ok else '✗'} {r.seconds:>5}s  {file}  {r.note}", flush=True)
    if results:
        n = len(results)
        print(f"\n{sum(r.ok for r in results)}/{n} passed · app first {sum(r.ranked for r in results)}/{n} · "
              f"cited {sum(r.cited for r in results)}/{n} · code {sum(r.found for r in results)}/{n}")


if __name__ == "__main__":
    folder = Path(sys.argv[sys.argv.index("--dir") + 1]) if "--dir" in sys.argv else CAPTURES
    asyncio.run(main(folder))
