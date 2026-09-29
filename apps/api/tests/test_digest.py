import unittest

from nox_api.agents.digest import generate_architecture_digest


class TestDigest(unittest.TestCase):
    def test_architecture_digest_generation(self):
        kb_files = {
            'index.md': '# Trading Platform Overview\n\nHigh-frequency distributed order matching system handling equity transactions.',
            'entities/order-matching.md': '# Order Matching Engine\n\nCore matching algorithm with price-time priority.',
            'summaries/api-spec.md': '# API Specification\n\n- `POST /api/orders` - Submit new limit/market order.\n- `GET /api/orders/{id}` - Fetch order status.',
            'decisions/001-matching.md': '# ADR 001\n\nEngine must only use in-memory ring buffers for sub-millisecond execution.',
        }
        
        digest = generate_architecture_digest('matching-engine', 'fintech-org', kb_files, max_chars=3800)
        self.assertLessEqual(len(digest), 3800)
        self.assertTrue('Trading Platform Overview' in digest or 'High-frequency' in digest)
        self.assertIn('Order Matching', digest)
        self.assertIn('POST /api/orders', digest)
        self.assertIn('Architectural Invariants', digest)

if __name__ == "__main__":
    unittest.main()
