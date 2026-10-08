"""Check the Tidewell demo estate against its manifest (demo/tidewell/estate.yaml).

- every app in the manifest has a codebase, and every codebase is in the manifest
- every contract an app provides or consumes is named in its README or code
- every topic an app publishes or subscribes to appears in its code
- every topic someone publishes has a subscriber, unless it is a planted orphan
- every planted beat's evidence file exists
- no banned (old project) names appear anywhere under demo/tidewell/

Run from the repo root:  python3 scripts/check_estate.py
"""

import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1] / "demo" / "tidewell"
m = yaml.safe_load((ROOT / "estate.yaml").read_text())
problems: list[str] = []


def text(app: str, readme: bool = True) -> str:
    files = [f for f in (ROOT / "codebases" / app).rglob("*") if f.is_file() and (readme or f.name != "README.md")]
    return "\n".join(f.read_text(errors="ignore") for f in files)


def contract_path(c: str) -> str:
    return re.sub(r"^(GET|POST|PUT|PATCH|DELETE|gRPC)\s+", "", c)


apps = m["apps"]
on_disk = {p.name for p in (ROOT / "codebases").iterdir() if p.is_dir()}
for missing in set(apps) - on_disk:
    problems.append(f"{missing}: in the manifest but has no codebase")
for extra in on_disk - set(apps):
    problems.append(f"{extra}: codebase not in the manifest")

for name, app in apps.items():
    if name not in on_disk:
        continue
    everything, code = text(name), text(name, readme=False)
    for c in app.get("provides", []) + app.get("consumes", []):
        if contract_path(c) not in everything:
            problems.append(f"{name}: contract `{c}` not named in README or code")
    for t in app.get("publishes", []) + app.get("subscribes", []):
        if t not in code:
            problems.append(f"{name}: topic `{t}` not in code")

published = {t: n for n, a in apps.items() for t in a.get("publishes", [])}
subscribed = {t for a in apps.values() for t in a.get("subscribes", [])}
orphans = {t for t in published if t not in subscribed}
planted_text = " ".join(p["beat"] for p in m["planted"])
for t in sorted(orphans):
    if t in planted_text:
        print(f"ℹ️  planted orphan: `{t}` (published by {published[t]}, no subscriber)")
    else:
        problems.append(f"`{t}` is published by {published[t]} but nobody subscribes")
for t in sorted(subscribed - set(published)):
    problems.append(f"`{t}` is subscribed to but nobody publishes it")

for p in m["planted"]:
    for ev in p["evidence"]:
        if not (ROOT / ev).exists():
            problems.append(f"planted {p['id']}: evidence {ev} is missing")

for branch, spec in m.get("branches", {}).items():
    if not (ROOT / "branches" / branch / spec["app"]).is_dir():
        problems.append(f"branch {branch}: no overlay at branches/{branch}/{spec['app']}")

banned = [w.lower() for w in m.get("banned_words", [])]
for f in ROOT.rglob("*"):
    if f.is_file() and f.name != "estate.yaml":
        low = f.read_text(errors="ignore").lower()
        for w in banned:
            if w in low:
                problems.append(f"banned word '{w}' in {f.relative_to(ROOT)}")

if problems:
    print("\n".join(f"❌ {p}" for p in problems))
    sys.exit(1)
print(f"✅ estate OK: {len(apps)} apps, {len(published)} topics, {len(m['planted'])} planted beats")
