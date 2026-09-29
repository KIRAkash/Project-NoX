import unittest
from typing import Any

from nox_api.agents.gatekeeper import run_gatekeeper
from nox_api.connectors import CONNECTOR_REGISTRY, check_source_updates, register_connector
from nox_api.connectors.base import BaseConnector, IncrementalDelta


class CustomTestConnector(BaseConnector):
    async def ingest(self, url: str, token: str | None, config: dict[str, Any] | None = None, on_progress=None) -> str:
        return f"# Custom Source: {url}\nIngested custom content."

    async def check_incremental_updates(self, url: str, token: str | None, last_state: dict[str, Any] | None = None, config: dict[str, Any] | None = None) -> IncrementalDelta:
        return IncrementalDelta(
            has_changes=True,
            delta_content=f"Custom delta from {url}",
            summary="New custom architectural RFC",
            new_state={"version": 2},
            affected_items=["rfc/001.md"],
            source_type="custom_rfc",
            source_url=url,
        )

class TestMultiSource(unittest.IsolatedAsyncioTestCase):
    async def test_custom_connector_registration(self):
        register_connector("custom_rfc", CustomTestConnector)
        self.assertIn("custom_rfc", CONNECTOR_REGISTRY)

        delta = await check_source_updates("custom_rfc", "https://docs.example.com/rfcs")
        self.assertTrue(delta.has_changes)
        self.assertEqual(delta.source_type, "custom_rfc")
        self.assertEqual(delta.summary, "New custom architectural RFC")

    async def test_gatekeeper_multi_source_evaluation(self):
        # Test gatekeeper evaluates Slack discussion delta
        slack_delta = """
        ### 💬 Real-time Slack Message from #architecture
        **lead_architect**: We are replacing REST with gRPC for all internal payment services and adding Kafka topic `payments.settled`.
        """
        decision = await run_gatekeeper(slack_delta)
        self.assertIn(decision["decision"], ("significant", "trivial"))
        self.assertIn("affected_files", decision)

if __name__ == '__main__':
    unittest.main()
