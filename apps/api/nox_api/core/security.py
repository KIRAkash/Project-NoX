import hashlib
import hmac


def validate_github_webhook_signature(payload: bytes, signature: str, secret: str) -> bool:
    """Check GitHub's X-Hub-Signature-256 header against the shared webhook secret."""
    if not signature:
        return False
    expected = "sha256=" + hmac.new(secret.encode("utf-8"), msg=payload, digestmod=hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
