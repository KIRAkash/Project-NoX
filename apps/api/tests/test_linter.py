import unittest

from nox_api.agents.linter import (
    WITHHELD_SECRET,
    check_schemas,
    check_secrets_and_pii,
    check_wikilinks,
    redact_secrets,
    run_linter,
)


class TestLinter(unittest.TestCase):
    def test_valid_knowledge_base(self):
        kb_files = {
            "index.md": "# Master Architecture\n\nSee [[summaries/api-spec]] and [[entities/order-service]] and [[decisions/001-jwt-auth]].",
            "summaries/api-spec.md": "# API Spec\n\nEndpoints for trading: [[entities/order-service]]. This is a comprehensive API specification covering all endpoints, parameters, return codes, and schema validation details for the order matching engine microservice.",
            "entities/order-service.md": "# Order Service\n\n## Responsibilities\nProcesses limit and market orders.\n\n## Dependencies\nDepends on [[decisions/001-jwt-auth]] for secure token validation.",
            "decisions/001-jwt-auth.md": "# ADR 001: JWT Auth\n\n## Status\nAccepted\n\n## Context\nNeed stateless authentication across microservices.\n\n## Decision\nUse RSA256 signed JWT tokens with 15-minute expiration window.",
            "AGENTS.md": "# AGENTS.md\nRules for agents.",
            "log.md": "# Log\nChangelog.",
            ".nox/brief.md": "# Architecture Brief\nCompact brief.",
        }
        report = run_linter(kb_files)
        self.assertTrue(report.is_valid)
        self.assertEqual(len(report.errors), 0)
        self.assertEqual(report.stats["total_files"], 7)

    def test_broken_wikilink_detection(self):
        kb_files = {
            "index.md": "# Master Architecture\n\nLink to [[missing-service]] and [[broken/page]].",
        }
        issues, _ = check_wikilinks(kb_files)
        self.assertEqual(len(issues), 2)
        self.assertTrue(all(i.severity == "error" for i in issues))

    def test_schema_validation_warnings(self):
        kb_files = {
            "decisions/002-database.md": "# Database Choice\n\nWe chose PostgreSQL for ACID compliance.",
            "entities/payment.md": "# Payment Entity\n\nHandles credit cards.",
        }
        issues = check_schemas(kb_files)
        self.assertGreaterEqual(len(issues), 3)

    def test_secrets_scanning(self):
        kb_files = {
            "summaries/config.md": "# Config\n\nSecret key: ghp_123456789012345678901234567890123456",
        }
        issues = check_secrets_and_pii(kb_files)
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0].category, "security")
        self.assertEqual(issues[0].severity, "error")

    def test_redact_secrets_withholds_vendor_tokens_and_assignments(self):
        kb_files = {
            "entities/channels.md": '| `SMS_API_KEY` | `"twsms_9f3b7c21d6e84a0b95c2f1e7a8d4c6b2"` |\n',
            "summaries/config.md": 'Set `api_key = "Zq8vLm2Rt5Xw9Ab3"` in the provider config.\n',
            "concepts/plans.md": "Tables `payment_plans` and `instalments`; topic `billing.instalment.due`.\n",
        }
        cleaned, found = redact_secrets(kb_files)
        self.assertNotIn("twsms_9f3b", cleaned["entities/channels.md"])
        self.assertIn(WITHHELD_SECRET, cleaned["entities/channels.md"])
        self.assertEqual(cleaned["summaries/config.md"], f'Set `api_key = "{WITHHELD_SECRET}"` in the provider config.\n')
        self.assertEqual(cleaned["concepts/plans.md"], kb_files["concepts/plans.md"])  # ordinary identifiers stay
        self.assertEqual({kind for _, kind, _ in found}, {"api_token", "secret_assignment"})
        self.assertEqual(check_secrets_and_pii(cleaned), [])  # the commit gate passes after redaction

if __name__ == "__main__":
    unittest.main()
