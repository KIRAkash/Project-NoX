"""Live Jira round-trip. Run with `make test-live` (needs a working Atlassian token in .env)."""

import pytest

from nox_api.core.config import settings
from nox_api.integrations.jira import JiraClient

pytestmark = pytest.mark.live


async def test_create_comment_and_transition_issue():
    async with JiraClient() as jira:
        created = await jira.create_issue(
            settings.JIRA_DEFAULT_PROJECT,
            "[nox live test] create + transition",
            "Created by NoX's live integration test. Safe to delete.",
            labels=["nox", "nox-live-test"],
        )
        key = created["key"]
        await jira.add_comment(key, "Comment from the live test.")
        statuses = {t["to"]["name"] for t in await jira.get_transitions(key)}
        target = next((s for s in ("In Progress", "Done") if s in statuses), None)
        assert target, f"no In Progress/Done transition available from {key}: {statuses}"
        await jira.transition_to(key, target)
        issue = await jira.get_issue(key, ["status", "labels"])
        assert issue["fields"]["status"]["name"] == target
        assert "nox-live-test" in issue["fields"]["labels"]
