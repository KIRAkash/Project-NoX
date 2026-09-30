"""NoX Local: reading a repo from disk, and publishing locally built pages (Markdown only) as a KB pull request."""

import subprocess

import pytest

from nox_api import local
from nox_api.agents import okf
from nox_api.services import search
from nox_api.services.local_storage import clear_kb_checkpoints, load_checkpoint_json


def test_read_repo_takes_tracked_text_files_and_skips_noise(tmp_path):
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "auth.py").write_text("def login(): ...\n")
    (tmp_path / "README.md").write_text("# Auth\n")
    (tmp_path / "package-lock.json").write_text("{}")
    (tmp_path / "node_modules").mkdir()
    (tmp_path / "node_modules" / "x.js").write_text("junk")
    (tmp_path / "logo.png").write_bytes(b"\x89PNG\x00\x00")
    (tmp_path / "untracked.py").write_text("secret = 1\n")
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    subprocess.run(["git", "-C", str(tmp_path), "add", "src/auth.py", "README.md", "package-lock.json", "logo.png"], check=True)
    raw, n = local.read_repo(tmp_path, max_files=50)
    assert n == 2 and raw.index("--- FILE: README.md ---") < raw.index("--- FILE: src/auth.py ---")  # README first
    assert "package-lock" not in raw and "PNG" not in raw and "untracked" not in raw and "node_modules" not in raw


@pytest.fixture
async def published(db_clean, monkeypatch):
    from nox_api.agents import runner
    from tests.test_missions import _setup_app

    monkeypatch.setattr(search, "embeddings_on", lambda: False)
    calls = {}
    monkeypatch.setattr(runner, "provision_kb_repo", lambda org, app, gh: "https://github.com/apex/kb-refunds-service")
    monkeypatch.setattr(runner, "commit_kb_to_branch", lambda repo, branch, files: calls.update(repo=repo, branch=branch, files=dict(files)))
    monkeypatch.setattr(runner, "open_pull_request", lambda repo, branch, title, body: calls.update(title=title, body=body) or f"https://github.com/{repo}/pull/7")
    kb = await _setup_app()
    yield kb, calls
    clear_kb_checkpoints(kb)


PAGES = {
    "index.md": "# refunds-service\n\nIssues refunds. See [[entities/ledger]].\n",
    "entities/ledger.md": "# Ledger\n\n## Responsibilities\nReverses payments; emits `order.refunded.v1`.\n\n## Dependencies\nPostgres.\n",
}


async def test_push_publishes_local_pages_as_a_kb_pr(published):
    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import KnowledgeBase, OrgInterfaceContract
    from tests.test_missions import _client

    kb, calls = published
    meta = {"model": "ollama_chat/gemma4:12b", "commit": "abc1234def", "mode": "build",
            "interfaces": [{"kind": "rest", "identifier": "POST /refunds", "direction": "exposes"}]}
    async with _client("developer") as dev:
        r = await dev.post("/api/v1/cli/kb/push", json={"app": "refunds-service", "files": PAGES, "meta": meta})
    assert r.status_code == 200, r.text
    assert r.json()["pr_url"] == "https://github.com/apex/kb-refunds-service/pull/7"
    # committed as an Open Knowledge Format bundle: every page plus the folder index OKF adds
    assert calls["branch"] == "kb/local-build-abc1234" and set(calls["files"]) == set(PAGES) | {"entities/index.md"}
    assert "gemma4:12b" in calls["title"] and "never left that machine" in calls["body"]
    stored = load_checkpoint_json(kb, "compiled_files.json")
    assert set(stored) == set(PAGES) | {"entities/index.md"} and okf.problems(stored) == []
    assert okf.split(stored["entities/ledger.md"])[0]["generated"]["by"] == "nox-local/gemma4:12b"
    assert okf.strip(stored["entities/ledger.md"]).strip() == PAGES["entities/ledger.md"].strip()
    async with AsyncSessionLocal() as db:
        row = await db.get(KnowledgeBase, __import__("uuid").UUID(kb))
        assert row.built_with == "local:gemma4:12b" and row.status.value == "in_review"
        contracts = (await db.execute(__import__("sqlalchemy").select(OrgInterfaceContract))).scalars().all()
        assert {c.identifier for c in contracts} >= {"/refunds", "order.refunded.v1"}
        hits = await search.search(db, "who emits order refunded", [kb])
        assert hits and hits[0].path == "entities/ledger.md"  # indexed for search on arrival


async def test_sync_push_merges_only_changed_pages(published):
    from tests.test_missions import _client

    kb, calls = published
    async with _client("developer") as dev:
        await dev.post("/api/v1/cli/kb/push", json={"app": "refunds-service", "files": PAGES, "meta": {"mode": "build", "commit": "a1"}})
        changed = {"entities/ledger.md": PAGES["entities/ledger.md"].replace("Postgres.", "Postgres, Redis.")}
        r = await dev.post("/api/v1/cli/kb/push", json={"app": "refunds-service", "files": changed, "meta": {"mode": "sync", "commit": "b2"}})
    assert r.status_code == 200 and calls["branch"] == "kb/local-sync-b2"
    assert {"entities/ledger.md"} <= set(calls["files"]) <= {"entities/ledger.md", "entities/index.md"}  # no other page re-committed
    merged = load_checkpoint_json(kb, "compiled_files.json")
    assert set(merged) == set(PAGES) | {"entities/index.md"} and "Redis" in merged["entities/ledger.md"]


async def test_push_rejects_unsafe_paths_unknown_apps_and_business_seat(published):
    from tests.test_missions import _client

    async with _client("developer") as dev:
        bad = await dev.post("/api/v1/cli/kb/push", json={"app": "refunds-service", "files": {"../../etc/x.md": "x"}})
        assert bad.status_code == 422
        code = await dev.post("/api/v1/cli/kb/push", json={"app": "refunds-service", "files": {"src/auth.py": "print(1)"}})
        assert code.status_code == 422  # only Markdown pages, never source files
        assert (await dev.post("/api/v1/cli/kb/push", json={"app": "nope", "files": PAGES})).status_code == 404
    async with _client("business") as biz:
        assert (await biz.post("/api/v1/cli/kb/push", json={"app": "refunds-service", "files": PAGES})).status_code == 403


async def test_local_mode_runs_one_at_a_time(monkeypatch):
    """NoX Local builds with the workflow too: Gemma (the local model), writers and reviewer one at a time."""
    from types import SimpleNamespace

    from nox_api.ai import config
    from nox_api.ai.agents import kb_builder

    from .ai_fakes import SlowFakeLlm
    from .test_ai_kb_builder import RAW, responder

    fake = SlowFakeLlm(responder=responder)
    monkeypatch.setattr(config, "local_model", lambda: fake)
    monkeypatch.setattr(config, "model", lambda tier=None: (_ for _ in ()).throw(AssertionError("cloud model used locally")))
    ctx = SimpleNamespace(kb_id=str(__import__("uuid").uuid4()), app_name="refunds", org_slug="apex", candidate_contracts=[], commit_sha="")
    try:
        files, _ = await kb_builder.build(ctx, RAW, local=True)
    finally:
        clear_kb_checkpoints(ctx.kb_id)
    assert {"summaries/api-spec.md", "entities/ledger.md", "concepts/refund-policy.md"} <= set(files)
    assert "## Responsibilities" in files["entities/ledger.md"]
    assert len(fake.requests) == 5 and fake.peak == 1
