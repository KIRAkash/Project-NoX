import unittest

from nox_api.agents.guard import (
    evaluate_diff_against_constraints,
    extract_constraints_from_kb,
)


class TestGuard(unittest.TestCase):
    def test_extract_constraints(self):
        kb_files = {
            'decisions/001-auth.md': (
                "# ADR 001\n\n"
                "- All external API endpoints must use JWT authorization tokens.\n"
                "- Engineers must never commit plaintext database credentials.\n"
            ),
            'concepts/architecture.md': (
                "# Concepts\n\n"
                "- Frontend components must never query database directly.\n"
            ),
        }
        constraints = extract_constraints_from_kb(kb_files)
        self.assertEqual(len(constraints), 3)
        self.assertTrue(any('jwt authorization' in c.rule_text.lower() for c in constraints))
        self.assertTrue(any('plaintext database credentials' in c.rule_text.lower() for c in constraints))

    def test_constraint_violation_detection(self):
        kb_files = {
            'decisions/001-auth.md': (
                "# ADR 001\n\n"
                "- Never use plaintext database passwords in config.\n"
            ),
        }
        constraints = extract_constraints_from_kb(kb_files)
        
        diff_bad = (
            "diff --git a/config.py b/config.py\n"
            "+++ b/config.py\n"
            "@@ -10,3 +10,3 @@\n"
            "+    plaintext_database_passwords = 'secret123'\n"
        )
        violations = evaluate_diff_against_constraints(diff_bad, constraints)
        self.assertGreaterEqual(len(violations), 1)
        self.assertIn('conflict with rule', violations[0].message)

if __name__ == "__main__":
    unittest.main()
