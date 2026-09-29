import asyncio
import logging
import os
import tempfile
from collections.abc import Callable
from typing import Any

import httpx

from ..services.local_storage import download_content, download_content_bytes
from .base import BaseConnector, IngestionError

try:
    from markitdown import MarkItDown
except ImportError:
    MarkItDown = None

logger = logging.getLogger(__name__)

class FileUploadConnector(BaseConnector):
    async def ingest(
        self,
        url: str,
        token: str | None = None,
        config: dict[str, Any] | None = None,
        on_progress: Callable[[str, dict[str, Any]], Any] | None = None
    ) -> str:
        if on_progress:
            try:
                on_progress("source_files_found", {
                    "source": url,
                    "file_count": 1
                })
            except Exception:
                pass

        try:
            ext = os.path.splitext(url.split('?')[0])[1].lower()
            supported_exts = {".docx", ".pptx", ".xlsx", ".csv", ".html"}
            image_exts = {".png", ".jpg", ".jpeg", ".webp", ".heic"}
            
            if ext in image_exts:
                raw_bytes = await asyncio.to_thread(download_content_bytes, url)
                import base64
                b64 = base64.b64encode(raw_bytes).decode('utf-8')
                content = f"![Uploaded Architecture Diagram]({url})\n<nox_image_payload base64=\"{b64}\" />"
            elif ext in supported_exts and MarkItDown is not None:
                raw_bytes = await asyncio.to_thread(download_content_bytes, url)
                with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
                    tmp.write(raw_bytes)
                    tmp_path = tmp.name
                
                try:
                    md = MarkItDown()
                    result = await asyncio.to_thread(md.convert, tmp_path)
                    content = result.text_content
                finally:
                    os.unlink(tmp_path)
            else:
                content = await asyncio.to_thread(download_content, url)
        except Exception as e:
            raise IngestionError(f"Error processing uploaded file: {str(e)}")

        if on_progress:
            try:
                on_progress("source_files_fetched", {
                    "source": url,
                    "fetched": 1,
                    "total": 1
                })
            except Exception:
                pass

        return content

async def process_uploaded_file(gcs_path: str, config: dict[str, Any] | None = None) -> str:
    async with httpx.AsyncClient() as client:
        connector = FileUploadConnector(client)
        return await connector.ingest(gcs_path, None, config=config)

