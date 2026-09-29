import unittest

from nox_api.agents.anchors import (
    extract_anchors_from_kb,
    find_intersecting_anchors,
    generate_anchor_tag,
    parse_git_diff_hunks,
)


class TestAnchors(unittest.TestCase):
    def test_anchor_tag_generation_and_extraction(self):
        tag = generate_anchor_tag('apps/api/routers/auth.py', 10, 45, '8f2a1b3')
        self.assertIn('<!-- anchor: apps/api/routers/auth.py:L10-L45 sha:8f2a1b3 -->', tag)

        kb_files = {
            'summaries/api-spec.md': f'{tag}\n\n# Auth API\n\nHandles OAuth authentication.',
            'entities/order.md': '<!-- anchor: src/models/order.py:L1-L120 -->\n\n# Order Model',
        }
        anchors = extract_anchors_from_kb(kb_files)
        self.assertEqual(len(anchors), 2)
        self.assertEqual(anchors[0].source_file, 'apps/api/routers/auth.py')
        self.assertEqual(anchors[0].line_start, 10)
        self.assertEqual(anchors[0].line_end, 45)
        self.assertEqual(anchors[0].commit_sha, '8f2a1b3')

    def test_git_diff_hunk_parsing(self):
        diff_sample = (
            "diff --git a/apps/api/routers/auth.py b/apps/api/routers/auth.py\n"
            "--- a/apps/api/routers/auth.py\n"
            "+++ b/apps/api/routers/auth.py\n"
            "@@ -25,6 +25,10 @@ def login():\n"
            "+    token = create_jwt_token()\n"
        )
        hunks = parse_git_diff_hunks(diff_sample)
        self.assertIn('apps/api/routers/auth.py', hunks)
        self.assertEqual(hunks['apps/api/routers/auth.py'], [(25, 34)])

    def test_anchor_intersection_detection(self):
        kb_files = {
            'summaries/api-spec.md': '<!-- anchor: apps/api/routers/auth.py:L10-L50 sha:8f2a1b3 -->\n\n# Auth Spec',
            'entities/unrelated.md': '<!-- anchor: src/utils/math.py:L1-L20 -->\n\n# Math Helper',
        }

        diff_hit = (
            "diff --git a/apps/api/routers/auth.py b/apps/api/routers/auth.py\n"
            "--- a/apps/api/routers/auth.py\n"
            "+++ b/apps/api/routers/auth.py\n"
            "@@ -25,5 +25,8 @@\n"
            "+    validate_token()\n"
        )
        hits = find_intersecting_anchors(diff_hit, kb_files)
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0].kb_file, 'summaries/api-spec.md')
        self.assertEqual(hits[0].source_file, 'apps/api/routers/auth.py')

        diff_miss = (
            "diff --git a/apps/api/routers/auth.py b/apps/api/routers/auth.py\n"
            "--- a/apps/api/routers/auth.py\n"
            "+++ b/apps/api/routers/auth.py\n"
            "@@ -80,5 +80,8 @@\n"
            "+    helper_func()\n"
        )
        miss_hits = find_intersecting_anchors(diff_miss, kb_files)
        self.assertEqual(len(miss_hits), 0)

if __name__ == "__main__":
    unittest.main()
