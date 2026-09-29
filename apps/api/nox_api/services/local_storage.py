import json
import logging
import os

from ..core.config import _ROOT_DIR, settings
from .gcs_storage import (
    clear_gcs_kb_checkpoints,
    download_from_gcs,
    gcs_blob_exists,
    generate_gcs_presigned_url,
    is_gcs_enabled,
    list_gcs_kb_files,
    upload_to_gcs,
)

logger = logging.getLogger(__name__)

LOCAL_STORAGE_DIR = os.path.join(str(_ROOT_DIR), "logdir", "archives")

def upload_content(kb_id: str, filename: str, content: str) -> str:
    """Upload content to GCS if configured, else write to local disk."""
    if is_gcs_enabled():
        try:
            return upload_to_gcs(kb_id, filename, content)
        except Exception as e:
            logger.warning(f"GCS upload failed, falling back to local storage: {e}")

    local_dir = os.path.join(LOCAL_STORAGE_DIR, kb_id)
    os.makedirs(local_dir, exist_ok=True)
    local_file = os.path.join(local_dir, filename)
    
    # Ensure parent dir for sub-paths (e.g. pages/...)
    os.makedirs(os.path.dirname(local_file), exist_ok=True)
    with open(local_file, "w", encoding="utf-8") as f:
        f.write(content)
    return f"local://{local_file}"

def download_content(path: str) -> str:
    """Download content from a gs:// or local:// URI."""
    if path.startswith("gs://"):
        return download_from_gcs(path)
    if path.startswith("local://"):
        file_path = path[8:]
        with open(file_path, encoding="utf-8") as f:
            return f.read()
    # Treat plain filesystem path as local
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as f:
            return f.read()
    raise ValueError(f"Invalid storage path: {path}")

def download_content_bytes(path: str) -> bytes:
    """Download content from a gs:// or local:// URI as bytes."""
    if path.startswith("gs://"):
        from .gcs_storage import download_bytes_from_gcs
        return download_bytes_from_gcs(path)
    if path.startswith("local://"):
        file_path = path[8:]
        with open(file_path, "rb") as f:
            return f.read()
    # Treat plain filesystem path as local
    if os.path.isfile(path):
        with open(path, "rb") as f:
            return f.read()
    raise ValueError(f"Invalid storage path: {path}")

def content_exists(kb_id: str, filename: str) -> bool:
    """Check if content exists in GCS or local disk."""
    if is_gcs_enabled():
        if gcs_blob_exists(kb_id, filename):
            return True

    local_file = os.path.join(LOCAL_STORAGE_DIR, kb_id, filename)
    return os.path.exists(local_file) and os.path.getsize(local_file) > 0

def load_kb_content(kb_id: str, filename: str) -> str | None:
    """Load content string from GCS or local disk."""
    if is_gcs_enabled():
        try:
            gcs_uri = f"gs://{settings.GCS_BUCKET_NAME}/kbs/{kb_id}/{filename}"
            return download_from_gcs(gcs_uri)
        except Exception:
            pass

    local_file = os.path.join(LOCAL_STORAGE_DIR, kb_id, filename)
    if os.path.exists(local_file) and os.path.getsize(local_file) > 0:
        try:
            with open(local_file, encoding="utf-8") as f:
                return f.read()
        except Exception:
            return None
    return None

def save_checkpoint_json(kb_id: str, filename: str, data: dict) -> str:
    return upload_content(kb_id, filename, json.dumps(data, indent=2))

def load_checkpoint_json(kb_id: str, filename: str) -> dict | None:
    content = load_kb_content(kb_id, filename)
    if content:
        try:
            return json.loads(content)
        except Exception:
            return None
    return None

def generate_presigned_upload_url(filename: str) -> str:
    """Generate upload URL for client uploads (GCS presigned PUT or local endpoint)."""
    if is_gcs_enabled():
        return generate_gcs_presigned_url(filename)
    return "/api/upload/local"

def list_kb_files(kb_id: str) -> list[str]:
    """List all stored files for a KB."""
    if is_gcs_enabled():
        gcs_files = list_gcs_kb_files(kb_id)
        if gcs_files:
            return gcs_files

    local_dir = os.path.join(LOCAL_STORAGE_DIR, kb_id)
    if not os.path.exists(local_dir):
        return []
    files = []
    for root, _, filenames in os.walk(local_dir):
        for f in filenames:
            full_path = os.path.join(root, f)
            files.append(f"local://{full_path}")
    return files

def clear_kb_checkpoints(kb_id: str) -> bool:
    """Delete all cached checkpoint files for a KB to restart from scratch."""
    gcs_cleared = False
    if is_gcs_enabled():
        gcs_cleared = clear_gcs_kb_checkpoints(kb_id)

    import shutil
    local_dir = os.path.join(LOCAL_STORAGE_DIR, kb_id)
    local_cleared = False
    if os.path.exists(local_dir):
        try:
            shutil.rmtree(local_dir)
            local_cleared = True
        except Exception:
            pass
    return gcs_cleared or local_cleared


