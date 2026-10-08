"""Regressions for bugs found while porting the engine."""

import asyncio
import socket

import pytest


def _redis_up() -> bool:
    try:
        socket.create_connection(("localhost", 6379), timeout=0.5).close()
        return True
    except OSError:
        return False


def test_kb_resolve_is_matched_before_kb_id():
    """`/kb/resolve` must be registered before `/kb/{kb_id}` or it is swallowed as kb_id='resolve'."""
    from nox_api.routers import kb

    paths = [r.path for r in kb.router.routes]
    assert paths.index("/api/v1/kb/resolve") < paths.index("/api/v1/kb/{kb_id}")


def test_rollup_pipeline_names_resolve():
    """Flow C referenced select/selectinload/OrgKB/provision_org_kb_repo without importing them."""
    from nox_api.agents import runner

    for name in ("select", "selectinload", "OrgKB", "provision_org_kb_repo"):
        assert hasattr(runner, name), name


@pytest.mark.skipif(not _redis_up(), reason="needs Redis on localhost:6379")
async def test_sse_events_cross_managers_via_redis():
    """A pipeline in a worker process uses its own SSEManager; subscribers must still receive its events."""
    from nox_api.services.sse import SSEManager

    subscriber, publisher = SSEManager(), SSEManager()
    queue = await subscriber.subscribe("test-kb")
    await asyncio.sleep(0.2)  # let the Redis subscription settle
    await publisher.broadcast("test-kb", {"type": "pipeline_started", "payload": {"n": 1}})
    event = await asyncio.wait_for(queue.get(), timeout=3)
    await subscriber.unsubscribe("test-kb", queue)
    assert event == {"type": "pipeline_started", "payload": {"n": 1}}


async def test_rollup_reads_stored_pages_and_opens_org_pr(db_clean, monkeypatch):
    """Flow C imported a module that no longer existed and read only a GCS index, so every rollup failed or saw
    blank apps. It must read each app's stored pages (index and summaries) and open the org PR."""
    from nox_api.agents import runner
    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import KBStatus, KnowledgeBase, Org, OrgKB
    from nox_api.services import local_storage
    from nox_api.services.sse import SSEManager

    pages = {"index.md": "# {app}\n\nThe {app} service.", "summaries/api-spec.md": "# API\n\n`GET /v1/{app}`"}
    monkeypatch.setattr(local_storage, "load_checkpoint_json",
                        lambda kb_id, name: {p: c.format(app=apps[kb_id]) for p, c in pages.items()})
    seen, committed = {}, {}

    async def fake_rollup(org_id, app_kbs, existing):
        seen.update({k["app_name"]: k["index"] for k in app_kbs})
        return {"index.md": "# Org\n\nHow the apps connect."}

    monkeypatch.setattr(runner, "run_rollup", fake_rollup)
    monkeypatch.setattr(runner, "provision_org_kb_repo", lambda slug, gh: f"https://github.com/acme/kb-org-{slug}")
    monkeypatch.setattr(runner, "commit_kb_to_branch", lambda repo, branch, files: committed.update(files))
    monkeypatch.setattr(runner, "open_pull_request", lambda repo, branch, title, body: f"https://github.com/{repo}/pull/1")

    async with AsyncSessionLocal() as db:
        org = Org(slug="billing", name="Billing")
        db.add(org)
        await db.flush()
        kbs = [KnowledgeBase(org_id=org.id, app_name=n, status=KBStatus.published, source_urls=[]) for n in ("plans", "payments")]
        db.add_all(kbs)
        await db.commit()
        apps = {str(k.id): k.app_name for k in kbs}
        org_id = str(org.id)

    async with AsyncSessionLocal() as db:
        await runner.run_rollup_pipeline(org_id, db, SSEManager())
        org_kb = (await db.execute(runner.select(OrgKB))).scalars().one()

    assert set(seen) == {"plans", "payments"}
    assert "`GET /v1/plans`" in seen["plans"] and "The plans service." in seen["plans"]
    assert "index.md" in committed
    assert org_kb.pr_url == "https://github.com/acme/kb-org-billing/pull/1"
