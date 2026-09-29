"""Knowledge bases as Open Knowledge Format (OKF v0.2) bundles."""

from nox_api.agents import okf
from nox_api.agents.digest import generate_architecture_digest
from nox_api.agents.linter import run_linter

ENTITY = """<!-- anchor: src/book.ts:L1-L80 sha:abc -->

# Order Book Consumer

The **order book consumer** reads depth snapshots from Kafka and caches them in [[redis-cache]].

## Responsibilities
- Consume `nte.orderbook.snapshots`

## Dependencies
- [[redis-cache]]
"""

KB = {
    "index.md": "# market-data-gateway\n\nThe gateway fans market data out to clients over WebSockets.\n\nSee [[entities/order-book-consumer]].\n",
    "entities/order-book-consumer.md": ENTITY,
    "entities/redis-cache.md": "# Redis Cache\n\nHolds the latest L2 book per symbol so new clients hydrate instantly. Written by the [[order-book-consumer]].\n",
    "decisions/redis-l2-state-caching.md": "# Cache L2 state in Redis\n\n## Status\nAccepted\n\n## Context\nClients need a snapshot.\n\n## Decision\nUse Redis.\n",
    "log.md": "# 📜 Log\n\n| Date (UTC) | Action | Actor / Tool | Summary / Details |\n|:---|:---|:---|:---|\n| 2026-09-20 10:00 UTC | Initial OpenKB Generation | NoX Agent | Initial documentation compilation |\n",
}


def bundle():
    return okf.to_okf(KB, existing=KB, app="market-data-gateway", repo_url="https://github.com/apex/kb-mdg",
                      actor="nox/gemini-3.7-flash", source_repo="https://github.com/apex/market-data-gateway")


def test_every_page_gets_okf_frontmatter_with_a_type():
    out = bundle()
    meta, body = okf.split(out["entities/order-book-consumer.md"])
    assert meta["type"] == "Component"
    assert meta["title"] == "Order Book Consumer"
    assert meta["description"].startswith("The order book consumer reads depth snapshots")
    assert meta["resource"] == "https://github.com/apex/kb-mdg/blob/main/entities/order-book-consumer.md"
    assert meta["tags"] == ["market-data-gateway", "entities"]
    assert meta["sources"] == [{"resource": "https://github.com/apex/market-data-gateway/blob/HEAD/src/book.ts"}]
    assert meta["generated"]["by"] == "nox/gemini-3.7-flash"
    assert meta["generated"]["at"].endswith("Z")
    assert body.lstrip().startswith("<!-- anchor:")  # the page itself is untouched
    assert okf.split(out["decisions/redis-l2-state-caching.md"])[0]["type"] == "Architecture Decision"
    assert okf.problems({**KB, **out}) == []


def test_unknown_frontmatter_keys_survive_a_rewrite():
    page = okf.join({"type": "Old", "owner": "trading-team"}, "# Redis Cache\n\nBody text here.\n")
    out = okf.to_okf({"entities/redis-cache.md": page}, existing={}, app="a", repo_url=None, actor="nox/x")
    meta, _ = okf.split(out["entities/redis-cache.md"])
    assert meta["owner"] == "trading-team" and meta["type"] == "Component" and meta["resource"] == "/entities/redis-cache.md"


def test_folder_indexes_list_pages_with_descriptions_and_bundle_absolute_links():
    out = bundle()
    idx = out["entities/index.md"]
    assert idx.startswith("# Components and data models")
    assert "- [Order Book Consumer](/entities/order-book-consumer.md) — The order book consumer reads" in idx
    assert "[Redis Cache](/entities/redis-cache.md)" in idx
    assert okf.split(idx)[0] == {}  # OKF §8: index files need no frontmatter
    assert "decisions/index.md" in out


def test_root_index_declares_the_version_and_links_the_folders_once():
    out = bundle()
    meta, body = okf.split(out["index.md"])
    assert meta["okf_version"] == okf.OKF_VERSION
    assert "The gateway fans market data out" in body
    assert "[Components and data models](/entities/index.md) — 2 pages." in body
    again = okf.to_okf({"index.md": out["index.md"]}, existing={**KB, **out}, app="market-data-gateway", repo_url=None, actor="nox/x")
    assert again["index.md"].count("<!-- okf:contents -->") == 1


def test_a_patch_only_touches_the_pages_it_changed():
    first = {**KB, **bundle()}
    changed = {"entities/redis-cache.md": "# Redis Cache\n\nNow also holds trade prints for replay.\n"}
    out = okf.to_okf(changed, existing=first, app="market-data-gateway", repo_url=None, actor="nox/x")
    assert "entities/order-book-consumer.md" not in out  # its header (and timestamp) stay as they were
    assert "entities/redis-cache.md" in out
    assert "Now also holds trade prints" in out["entities/index.md"]  # the folder index follows the description
    assert "decisions/index.md" not in out


def test_log_is_date_grouped_newest_first():
    log = okf.normalize_log(KB["log.md"])
    assert log.startswith("# Change log\n\n## 2026-09-20\n\n- **Creation** Initial OpenKB Generation")
    log = okf.append_log(log, "Synced two pages.", ["Updated entities/redis-cache.md"])
    today = okf.now()[:10]
    headings = [line[3:] for line in log.splitlines() if line.startswith("## ")]
    assert headings == [today, "2026-09-20"]
    assert log.split(f"## {today}\n\n", 1)[1].startswith("- **Update** Synced two pages.\n  - Updated entities/redis-cache.md")


def test_linter_treats_folder_indexes_as_reserved_and_reports_okf():
    files = {**KB, **bundle()}
    report = run_linter(files)
    flagged = {i.file_path for i in report.errors + report.warnings}
    assert "entities/index.md" not in flagged and "decisions/index.md" not in flagged
    assert report.stats["okf_problems"] == 0
    assert run_linter(KB).stats["okf_problems"] == 3  # before conversion: three concept pages without frontmatter


def test_agent_brief_never_contains_frontmatter_or_the_contents_list():
    brief = generate_architecture_digest("market-data-gateway", "apex", {**KB, **bundle()})
    assert "okf_version" not in brief and "generated:" not in brief and "okf:contents" not in brief
    assert "fans market data out" in brief
