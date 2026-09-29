import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from github import InputGitAuthor

from nox_api.core.config import settings
from nox_api.services.gitops import (
    _load_private_key,
    get_bot_committer,
    get_github_app_installation_token,
    get_github_client,
)


class TestGitHubAppAuth(unittest.TestCase):
    def test_get_bot_committer(self):
        with patch.object(settings, "GITHUB_APP_SLUG", "custom-bot"):
            with patch.object(settings, "GITHUB_APP_ID", "98765"):
                committer = get_bot_committer()
                self.assertIsInstance(committer, InputGitAuthor)
                self.assertEqual(committer._identity["name"], "custom-bot[bot]")
                self.assertEqual(committer._identity["email"], "98765+custom-bot[bot]@users.noreply.github.com")

    def test_load_private_key_inline(self):
        with patch.object(settings, "GITHUB_APP_PRIVATE_KEY", "-----BEGIN RSA PRIVATE KEY-----\\nMIIE...\\n-----END RSA PRIVATE KEY-----"):
            with patch.object(settings, "GITHUB_APP_PRIVATE_KEY_PATH", None):
                key = _load_private_key()
                self.assertIn("\n", key)
                self.assertNotIn("\\n", key)
                self.assertTrue(key.startswith("-----BEGIN RSA PRIVATE KEY-----"))

    def test_load_private_key_from_file(self):
        with tempfile.NamedTemporaryFile("w+", delete=False) as f:
            key_content = "-----BEGIN RSA PRIVATE KEY-----\nMIIEogIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----"
            f.write(key_content)
            f.flush()
            temp_path = f.name

        try:
            with patch.object(settings, "GITHUB_APP_PRIVATE_KEY", None):
                with patch.object(settings, "GITHUB_APP_PRIVATE_KEY_PATH", temp_path):
                    key = _load_private_key()
                    self.assertEqual(key, key_content)
        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)

    def test_get_github_client_fallback_to_pat(self):
        with patch.object(settings, "GITHUB_APP_ID", None):
            with patch.object(settings, "GITHUB_APP_TOKEN", "ghp_mock_token_123"):
                g = get_github_client()
                self.assertIsNotNone(g)

    def test_get_github_app_installation_token_mock(self):
        with patch.object(settings, "GITHUB_APP_ID", "12345"):
            with patch.object(settings, "GITHUB_APP_INSTALLATION_ID", "67890"):
                with patch("nox_api.services.gitops._load_private_key", return_value="dummy-key"):
                    with patch("nox_api.services.gitops.Auth.AppAuth") as mock_app_auth:
                        with patch("nox_api.services.gitops.GithubIntegration") as mock_gi_cls:
                            mock_gi = MagicMock()
                            mock_access = MagicMock()
                            mock_access.token = "ghs_test_installation_token_abc"
                            mock_gi.get_access_token.return_value = mock_access
                            mock_gi_cls.return_value = mock_gi

                            token = get_github_app_installation_token()
                            self.assertEqual(token, "ghs_test_installation_token_abc")
                            mock_gi.get_access_token.assert_called_once_with(67890)


if __name__ == "__main__":
    unittest.main()
