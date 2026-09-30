"""Test setup: point the app at a dedicated `nox_test` database before anything imports it."""

import asyncio
import os
import subprocess
from pathlib import Path

import pytest
from dotenv import dotenv_values

_ROOT = Path(__file__).resolve().parents[3]
_base_url = os.environ.get("DATABASE_URL") or dotenv_values(_ROOT / ".env").get("DATABASE_URL") or (
    "postgresql+asyncpg://postgres:postgres@localhost:5432/nox"
)
TEST_DB_URL = os.environ.get("TEST_DATABASE_URL") or _base_url.rsplit("/", 1)[0] + "/nox_test"
os.environ["DATABASE_URL"] = TEST_DB_URL
os.environ["NOX_DEV_AUTH"] = "true"
os.environ["NOX_DEMO_ORG_SLUGS"] = ""  # tests opt in explicitly
os.environ["NOX_TICKET_STORE"] = "memory"  # never write test tickets to Firestore
os.environ.setdefault("WEBHOOK_SECRET", "test-webhook-secret-0123456789")

_TABLES = "shield_findings, kb_chunks, mission_events, external_links, spec_chat_messages, spec_file_versions, spec_files, mission_apps, missions, kb_pins, org_invites, memberships, api_tokens, users, kb_events, source_monitors, org_interface_contracts, knowledge_bases, org_kbs, orgs"


def _db_reachable() -> bool:
    import asyncpg

    async def probe():
        admin = TEST_DB_URL.replace("+asyncpg", "").rsplit("/", 1)[0] + "/postgres"
        conn = await asyncpg.connect(admin, timeout=3)
        if not await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = 'nox_test'"):
            await conn.execute("CREATE DATABASE nox_test")
        await conn.close()

    try:
        asyncio.run(probe())
        return True
    except Exception:
        return False


DB_AVAILABLE = _db_reachable()
if DB_AVAILABLE:
    subprocess.run(["alembic", "upgrade", "head"], cwd=Path(__file__).resolve().parents[1], check=True,
                   env={**os.environ}, capture_output=True)


@pytest.fixture
async def db_clean():
    """Empty every table before the test; skip when no Postgres is available."""
    if not DB_AVAILABLE:
        pytest.skip("needs Postgres")
    from sqlalchemy import text

    from nox_api.db.database import engine
    from nox_api.services.tickets import reset_store

    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {_TABLES} CASCADE"))
    reset_store()  # mission numbers restart at NOX-1, so ticket documents must too
    yield
    await engine.dispose()  # connections are bound to this test's event loop


@pytest.fixture
def fake_nox(monkeypatch):
    """NoX's drafts without calling Gemini: a small, recognisable file per role."""

    async def fake_generate(mission, role, upstream, context, current=None, instruction=None, **kw):
        return f"# {role.value.title()} file: {mission.prompt[:30]}\n\nupstream={sorted(r.value for r in upstream)}\n\n## Verification checklist\n- [ ] it works\n"

    from nox_api.missions import drafting

    monkeypatch.setattr(drafting, "generate_file", fake_generate)
