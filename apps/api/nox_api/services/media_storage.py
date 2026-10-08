"""Where captures live: Cloud Storage in production, a local folder in development.

Recordings can show private screens, so a capture's bytes are never behind an unguessable-URL capability
like mission images are. Reads go through an auth check that hands out a short-lived URL: a V4 signed GET
on Cloud Storage, or an HMAC-signed API URL locally (so `<video>` and `<track>` can load and seek without
sending headers). Uploads go straight to Cloud Storage with a signed PUT, since Cloud Run caps request bodies
at 32 MiB; locally the browser PUTs to the API instead.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from pathlib import Path

from ..core.config import _ROOT_DIR, settings
from .gcs_storage import generate_gcs_presigned_url, get_gcs_client, is_gcs_enabled

EXT = {
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic",
    "video/webm": "webm", "video/mp4": "mp4", "video/quicktime": "mov",
    "audio/webm": "weba", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav",
    "audio/x-wav": "wav", "audio/ogg": "ogg",
}


def base_mime(mime: str) -> str:
    """'video/webm;codecs=vp9,opus' → 'video/webm'."""
    return mime.split(";")[0].strip().lower()


def uses_gcs() -> bool:
    return settings.STORAGE_BACKEND == "gcs" and is_gcs_enabled()


def object_path(org_id, media_id, mime: str) -> str:
    return f"media/{org_id}/{media_id}.{EXT.get(base_mime(mime), 'bin')}"


def _local_dir() -> Path:
    d = Path(_ROOT_DIR) / "logdir" / "mission_assets" / "media"
    d.mkdir(parents=True, exist_ok=True)
    return d


def storage_uri(org_id, media_id, mime: str) -> str:
    path = object_path(org_id, media_id, mime)
    if uses_gcs():
        return f"gs://{settings.GCS_BUCKET_NAME}/{path}"
    return f"local://{_local_dir() / path.removeprefix('media/')}"


def local_path(uri: str) -> Path:
    return Path(uri.removeprefix("local://"))


def _blob(uri: str):
    bucket, _, name = uri.removeprefix("gs://").partition("/")
    return get_gcs_client().bucket(bucket).blob(name)


def signed_put_url(uri: str, mime: str) -> str:
    return generate_gcs_presigned_url("", content_type=mime, object_path=uri.removeprefix("gs://").partition("/")[2])


def signed_get_url(uri: str, minutes: int = 5) -> str:
    return generate_gcs_presigned_url("", expires_in_minutes=minutes, object_path=uri.removeprefix("gs://").partition("/")[2], method="GET")


def stat(uri: str) -> tuple[int, str | None] | None:
    """(size, content type) of the stored object, or None when it isn't there."""
    if uri.startswith("gs://"):
        blob = _blob(uri)
        if not blob.exists():
            return None
        blob.reload()
        return blob.size or 0, blob.content_type
    p = local_path(uri)
    return (p.stat().st_size, None) if p.is_file() else None


def read_bytes(uri: str) -> bytes:
    if uri.startswith("gs://"):
        return _blob(uri).download_as_bytes()
    return local_path(uri).read_bytes()


def delete(uri: str) -> None:
    if uri.startswith("gs://"):
        blob = _blob(uri)
        if blob.exists():
            blob.delete()
    else:
        local_path(uri).unlink(missing_ok=True)


# ── Spoken replies (Listen): cached by content hash, so a replay costs nothing ──

def speech_uri(key: str) -> str:
    if uses_gcs():
        return f"gs://{settings.GCS_BUCKET_NAME}/voice/{key}.wav"
    d = Path(_ROOT_DIR) / "logdir" / "voice"
    d.mkdir(parents=True, exist_ok=True)
    return f"local://{d / key}.wav"


def write_bytes(uri: str, data: bytes, mime: str) -> None:
    if uri.startswith("gs://"):
        _blob(uri).upload_from_string(data, content_type=mime)
    else:
        local_path(uri).write_bytes(data)


# ── Short-lived read tokens for the API's own content URLs ──────────────────

def _sig(media_id: str, what: str, exp: int) -> str:
    key = (settings.WEBHOOK_SECRET or "nox-dev").encode()
    return hmac.new(key, f"media:{media_id}:{what}:{exp}".encode(), hashlib.sha256).hexdigest()[:32]


def token_query(media_id: str, what: str, minutes: int = 5) -> str:
    exp = int(time.time()) + minutes * 60
    return f"exp={exp}&sig={_sig(str(media_id), what, exp)}"


def token_ok(media_id: str, what: str, exp: int | None, sig: str | None) -> bool:
    if not exp or not sig or exp < time.time():
        return False
    return hmac.compare_digest(sig, _sig(str(media_id), what, int(exp)))
