"""The demo estate manifest (demo/tidewell/estate.yaml) and the lock file the seeders write.

The manifest says what the demo contains. The lock file (demo/tidewell/.seeded.json, not committed)
records what the seeders created on the external sites (Slack channel ids, Notion page URLs), so
seed_org can turn each app's sources into URLs the connectors read.
"""

import json
from pathlib import Path

import yaml

ESTATE_DIR = Path(__file__).resolve().parents[4] / "demo" / "tidewell"
MANIFEST = ESTATE_DIR / "estate.yaml"
LOCK = ESTATE_DIR / ".seeded.json"


def load() -> dict:
    return yaml.safe_load(MANIFEST.read_text())


def read_lock() -> dict:
    return json.loads(LOCK.read_text()) if LOCK.exists() else {}


def write_lock(updates: dict) -> None:
    lock = read_lock()
    for section, values in updates.items():
        lock.setdefault(section, {}).update(values)
    LOCK.write_text(json.dumps(lock, indent=2, sort_keys=True) + "\n")


def walk_orgs(orgs: list[dict], parent: str | None = None):
    """Yield (slug, name, parent_slug) for the nested org tree, parents first."""
    for o in orgs:
        yield o["slug"], o["name"], parent
        yield from walk_orgs(o.get("children", []), o["slug"])


def page_title(md: str, fallback: str) -> str:
    for line in md.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return fallback


def page_body(md: str) -> str:
    """The page without its leading `# title` line (the title is set separately)."""
    lines = md.splitlines()
    if lines and lines[0].startswith("# "):
        lines = lines[1:]
    return "\n".join(lines).strip() + "\n"
