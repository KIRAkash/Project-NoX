"""
Google Cloud Storage (GCS) integration for NoX.

Provides cloud storage capabilities for:
1. User-uploaded documentation (PDF, Markdown, architecture diagrams).
2. Intermediary agent pipeline checkpoints.
3. Downloadable knowledge-base (OKF bundle) .zip archives.
"""

import logging
from datetime import timedelta

from ..core.config import settings

logger = logging.getLogger(__name__)

_gcs_client = None


def get_gcs_client():
    """Lazily initialize and return the Google Cloud Storage client."""
    global _gcs_client
    if _gcs_client is None:
        try:
            from google.cloud import storage
            _gcs_client = storage.Client()
            logger.info("Google Cloud Storage client initialized successfully.")
        except Exception as e:
            logger.warning(f"Could not initialize GCS client: {e}")
            return None
    return _gcs_client


def is_gcs_enabled() -> bool:
    """Check if GCS is configured and client is available."""
    if settings.STORAGE_BACKEND.lower() != "gcs":
        return False
    bucket_name = settings.GCS_BUCKET_NAME
    if not bucket_name or bucket_name in ("local", "none", ""):
        return False
    return get_gcs_client() is not None


def upload_to_gcs(kb_id: str, filename: str, content: str, content_type: str = "text/plain") -> str:
    """Upload content string to the configured GCS bucket."""
    client = get_gcs_client()
    if not client:
        raise RuntimeError("GCS client is not available")

    bucket = client.bucket(settings.GCS_BUCKET_NAME)
    blob_path = f"kbs/{kb_id}/{filename}"
    blob = bucket.blob(blob_path)
    blob.upload_from_string(content, content_type=content_type)
    
    return f"gs://{settings.GCS_BUCKET_NAME}/{blob_path}"


def download_from_gcs(gcs_uri: str) -> str:
    """Download content from a gs:// URI."""
    client = get_gcs_client()
    if not client:
        raise RuntimeError("GCS client is not available")

    if not gcs_uri.startswith("gs://"):
        raise ValueError(f"Invalid GCS URI: {gcs_uri}")

    parts = gcs_uri[5:].split("/", 1)
    bucket_name = parts[0]
    blob_name = parts[1]

    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_name)
    return blob.download_as_text(encoding="utf-8")


def download_bytes_from_gcs(gcs_uri: str) -> bytes:
    """Download content from a gs:// URI as bytes."""
    client = get_gcs_client()
    if not client:
        raise RuntimeError("GCS client is not available")

    if not gcs_uri.startswith("gs://"):
        raise ValueError(f"Invalid GCS URI: {gcs_uri}")

    parts = gcs_uri[5:].split("/", 1)
    bucket_name = parts[0]
    blob_name = parts[1]

    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_name)
    return blob.download_as_bytes()


def gcs_blob_exists(kb_id: str, filename: str) -> bool:
    """Check if a blob exists in GCS."""
    client = get_gcs_client()
    if not client:
        return False

    try:
        bucket = client.bucket(settings.GCS_BUCKET_NAME)
        blob_path = f"kbs/{kb_id}/{filename}"
        blob = bucket.blob(blob_path)
        return blob.exists()
    except Exception:
        return False


def generate_gcs_presigned_url(filename: str, content_type: str = "application/octet-stream", expires_in_minutes: int = 15,
                               object_path: str | None = None, method: str = "PUT") -> str:
    """A V4 signed URL for a direct browser upload (PUT, content type locked) or a short-lived read (GET).

    `object_path` names the object exactly; without it the object is `uploads/<filename>`.
    """
    client = get_gcs_client()
    if not client:
        return "/api/upload/local"

    try:
        bucket = client.bucket(settings.GCS_BUCKET_NAME)
        blob = bucket.blob(object_path or f"uploads/{filename}")
        url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(minutes=expires_in_minutes),
            method=method,
            content_type=content_type if method == "PUT" else None,
        )
        return url
    except Exception as e:
        logger.warning(f"Failed to generate GCS presigned URL: {e}")
        return "/api/upload/local"


def list_gcs_kb_files(kb_id: str) -> list[str]:
    """List all file URIs for a given KB in GCS."""
    client = get_gcs_client()
    if not client:
        return []

    try:
        bucket = client.bucket(settings.GCS_BUCKET_NAME)
        prefix = f"kbs/{kb_id}/"
        blobs = bucket.list_blobs(prefix=prefix)
        return [f"gs://{settings.GCS_BUCKET_NAME}/{b.name}" for b in blobs]
    except Exception as e:
        logger.error(f"Error listing GCS blobs for kb {kb_id}: {e}")
        return []


def clear_gcs_kb_checkpoints(kb_id: str) -> bool:
    """Delete all checkpoint blobs for a KB in GCS."""
    client = get_gcs_client()
    if not client:
        return False

    try:
        bucket = client.bucket(settings.GCS_BUCKET_NAME)
        prefix = f"kbs/{kb_id}/"
        blobs = list(bucket.list_blobs(prefix=prefix))
        if blobs:
            bucket.delete_blobs(blobs)
        return True
    except Exception as e:
        logger.error(f"Failed to delete GCS blobs for kb {kb_id}: {e}")
        return False
