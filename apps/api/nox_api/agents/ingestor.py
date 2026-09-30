import asyncio
import logging
import re

from ..connectors import ingest_source
from ..core.config import settings
from ..services.local_storage import load_kb_content, upload_content
from .llm_client import get_env_var, llm_client

logger = logging.getLogger(__name__)

SYSTEM_SUMMARISER = (
    "You are a senior software architect. Summarise the purpose of each file "
    "provided in 1–2 sentences. Be concise and precise."
)

SYSTEM_REDUCER = (
    "You are a senior software architect. Synthesise a coherent architectural "
    "overview from the per-file summaries provided. "
    "If you receive any images/diagrams alongside the text, carefully analyze their content, components, and data flows, and incorporate those insights into your final architectural synthesis."
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_junk_file(filepath: str) -> bool:
    """Return True for generated/lock files that add noise but no signal."""
    junk_names = {
        'package-lock.json', 'yarn.lock', 'poetry.lock', 'Pipfile.lock',
        'composer.lock', 'Cargo.lock', 'pnpm-lock.yaml', 'bun.lockb',
    }
    return filepath.split('/')[-1] in junk_names


def _chunk_by_files(raw_content: str, chunk_size: int) -> list:
    """Split raw content into chunks of ~chunk_size chars, on file boundaries."""
    parts = re.split(r'--- FILE: (.*?) ---', raw_content)
    if len(parts) <= 1:
        # Non-file-delimited format — simple character chunking
        return [raw_content[i:i + chunk_size] for i in range(0, len(raw_content), chunk_size)]

    chunks, current = [], ""
    for i in range(1, len(parts), 2):
        filepath = parts[i]
        if _is_junk_file(filepath):
            continue

        filecontent = parts[i + 1].strip()
        # Truncate individual files for the map phase
        if len(filecontent) > 6000:
            filecontent = filecontent[:6000] + "...[TRUNCATED FOR SUMMARY]"

        entry = f"--- FILE: {filepath} ---\n{filecontent}\n"
        if len(current) + len(entry) > chunk_size:
            if current:
                chunks.append(current)
            current = entry
        else:
            current += entry

    if current:
        chunks.append(current)
    return chunks


# ---------------------------------------------------------------------------
# Map phase — per-chunk summarisation
# ---------------------------------------------------------------------------

async def _map_chunks_local(chunks: list, log_callback=None) -> list:
    """Summarise chunks sequentially using Gemma (local).

    Passes the previous chunk's summary as rolling context so Gemma builds
    a coherent picture incrementally despite its small context window.
    """
    summaries = []
    prev_summary = ""
    for i, chunk in enumerate(chunks):
        if log_callback:
            await log_callback("map_reduce_progress", {
                "chunk": i + 1,
                "total_chunks": len(chunks),
                "message": f"Analyzing code modules ({i + 1}/{len(chunks)})"
            })
        logger.info(f"[MAP/local] Summarising chunk {i + 1}/{len(chunks)}...")

        context_hint = (
            f"\n\nPrevious chunks summary for context:\n{prev_summary}\n\n"
            if prev_summary else ""
        )
        prompt = (
            f"Summarise the purpose of each file provided below in 1–2 sentences each."
            f"{context_hint}\n\n{chunk}"
        )
        summary = await llm_client.generate(
            prompt=prompt,
            system=SYSTEM_SUMMARISER,
            force_mode="local",
            num_ctx_override=8192,
        )
        summaries.append(summary)
        prev_summary = summary  # rolling context
    return summaries


async def _map_chunks_remote(chunks: list, log_callback=None) -> list:
    """Summarise chunks concurrently using Gemini (remote/hybrid)."""
    if log_callback:
        await log_callback(
            "map_reduce_progress",
            {
                "status": "running_concurrently",
                "total_chunks": len(chunks),
                "message": f"Analyzing {len(chunks)} code modules in parallel"
            }
        )
    items = [
        {"prompt": f"Summarise the purpose of each file below in 1–2 sentences each.\n\n{chunk}",
         "system": SYSTEM_SUMMARISER}
        for chunk in chunks
    ]
    return await llm_client.generate_batch(
        items,
        semaphore_limit=5,
        force_mode="remote",
    )


# ---------------------------------------------------------------------------
# Reduce phase — synthesise all summaries into architecture index
# ---------------------------------------------------------------------------

async def _reduce_summaries(summaries: list, force_mode=None, images: list | None = None) -> str:
    """Combine per-chunk summaries into a coherent architecture index."""
    joined = "\n\n".join(summaries)
    prompt = (
        "Below are file-level summaries of a codebase, grouped in chunks.\n\n"
        "Synthesise a coherent, high-level architectural overview from these summaries. "
        "Identify the main components, data flows, and design patterns. "
        "Do NOT repeat individual file summaries — produce a concise narrative.\n\n"
        f"Summaries:\n{joined}"
    )
    return await llm_client.generate(prompt=prompt, system=SYSTEM_REDUCER, force_mode=force_mode, images=images)


# ---------------------------------------------------------------------------
# Sources → one snapshot
# ---------------------------------------------------------------------------

async def gather_sources(context, sources: list = None, tokens: dict = None, log_callback=None) -> str:
    """Fetch every source through its connector into one snapshot and archive it as raw_ingest.txt.

    NoX Shield screens each source as it arrives (services/shield.py): a document Model Armor flags is replaced
    in the snapshot by a short notice, so its text never reaches a prompt. The flight log gets one
    `shield_screened` summary and one `shield_withheld` event per withheld source.
    """
    from ..services import shield

    sources = sources or []
    tokens = tokens or {}
    raw_content = ""
    screened = {"documents": 0, "withheld": [], "unscreened": 0, "findings": 0}
    if sources:
        for source in sources:
            s_type = source.get('type') if isinstance(source, dict) else getattr(source, 'type', None)
            s_url = source.get('url') if isinstance(source, dict) else getattr(source, 'url', None)
            s_config = source.get('config') if isinstance(source, dict) else getattr(source, 'config', None)

            if log_callback:
                await log_callback("source_scanning", {
                    "source": s_url,
                    "type": s_type,
                    "message": f"Scanning {s_type.upper() if s_type else 'source'} structure and configuration"
                })

            def _on_progress(event_name, data):
                if log_callback:
                    try:
                        loop = asyncio.get_event_loop()
                        if loop.is_running():
                            asyncio.create_task(log_callback(event_name, data))
                    except Exception:
                        pass

            try:
                content = await ingest_source(s_type, s_url, tokens, config=s_config, on_progress=_on_progress)
                content, report = await shield.guard_source(s_type, s_url, content, kb_id=context.kb_id,
                                                            org_id=getattr(context, "org_id", None) or None)
                for k in ("documents", "unscreened", "findings"):
                    screened[k] += report[k]
                for name in report["withheld"]:
                    screened["withheld"].append(name)
                    if log_callback:
                        await log_callback("shield_withheld", {
                            "source": name, "type": s_type,
                            "message": f"Shield withheld {name}: possible prompt injection or unsafe content",
                        })
                raw_content += f"\n\n=== SOURCE: {s_url} ===\n{content}"
                if log_callback:
                    await log_callback("source_downloaded", {
                        "source": s_url,
                        "type": s_type,
                        "message": f"Successfully ingested codebase and documents from {s_type.upper() if s_type else 'source'}"
                    })
            except Exception as e:
                raw_content += f"\n\n=== SOURCE: {s_url} ===\n[Ingestion failed: {e}]"

        if log_callback and shield.mode() != "off":
            n, held, missed = screened["documents"], len(screened["withheld"]), screened["unscreened"]
            message = f"Shield screened {n} document{'s' if n != 1 else ''} · {held} withheld"
            if missed:
                message += f" · {missed} not screened (Shield unreachable)"
            await log_callback("shield_screened", {"documents": n, "withheld": held, "unscreened": missed,
                                                   "findings": screened["findings"], "mode": shield.mode(), "message": message})


        # Archive raw content
        try:
            upload_content(context.kb_id, "raw_ingest.txt", raw_content)
            if log_callback:
                await log_callback("archive_uploaded", {
                    "message": "Source snapshot securely archived for synthesis"
                })
        except Exception as e:
            logger.warning(f"Local archive save failed: {e}")


    return raw_content


# ---------------------------------------------------------------------------
# Main ingestor entry point
# ---------------------------------------------------------------------------

async def run_ingestor(context, sources: list = None, tokens: dict = None, log_callback=None) -> tuple:
    """Ingest all sources and produce (architecture_index, raw_content).

    Strategy by AI_MODE:
      local  — map=local sequential (8k ctx), reduce=local
      remote — if total chars < REMOTE_INLINE_THRESHOLD: skip map-reduce,
               send full content to Gemini in one call; else map=remote
               concurrent, reduce=remote
      hybrid — MAP=local (Gemma, cheap), REDUCE=remote (Gemini, full context)
    """
    sources = sources or []
    tokens = tokens or {}
    
    # ── Checkpoint Check ──────────────────────────────────────────────────────
    cached_raw = load_kb_content(context.kb_id, "raw_ingest.txt")
    cached_index = load_kb_content(context.kb_id, "architecture_index.md")
    if cached_raw and cached_index:
        logger.info(f"⚡ [RESUME] Found existing ingestion checkpoint for KB {context.kb_id}. Skipping map-reduce.")
        if log_callback:
            await log_callback("checkpoint_resumed", {
                "step": "ingestion",
                "raw_chars": len(cached_raw),
                "index_chars": len(cached_index)
            })
        return cached_index, cached_raw

    raw_content = context.raw_content or cached_raw or await gather_sources(context, sources, tokens, log_callback)

    mode = get_env_var("AI_MODE", getattr(settings, "AI_MODE", "remote"))
    if log_callback:
        await log_callback("llm_analysis_started", {
            "message": "Analyzing application structure, interfaces, and architecture"
        })

    # Extract base64 images from raw_content if any
    import base64
    extracted_images = []
    def _extract_image_payload(match):
        try:
            extracted_images.append(base64.b64decode(match.group(1)))
        except:
            pass
        return "[IMAGE UPLOADED AND ATTACHED FOR VISION]"
        
    raw_content = re.sub(r'<nox_image_payload base64="([^"]+)"\s*/>', _extract_image_payload, raw_content)

    # ── Mode-specific map-reduce ──────────────────────────────────────────────

    if mode == "remote" and len(raw_content) <= settings.REMOTE_INLINE_THRESHOLD:
        # ── Remote inline: single Gemini call, no map-reduce ────────────────
        logger.info(
            f"[remote/inline] Repo under threshold "
            f"({len(raw_content)} chars). Single Gemini pass."
        )
        if log_callback:
            await log_callback("inline_pass_started", {
                "message": "Synthesizing comprehensive architectural blueprint"
            })

        architecture_index = await llm_client.generate(
            prompt=(
                "Below is the full source code of a software project.\n\n"
                "Write a comprehensive architectural overview: main components, "
                "data flows, design decisions, and key abstractions.\n\n"
                f"Code:\n{raw_content}"
            ),
            system=SYSTEM_REDUCER,
            force_mode="remote",
            images=extracted_images if extracted_images else None,
        )

    else:
        # ── Map-Reduce path ─────────────────────────────────────────────────
        # Use a much larger chunk size for Gemini to minimize concurrent API calls
        chunk_size = settings.LOCAL_CHUNK_SIZE if mode in ("local", "hybrid") else 500000
        chunks = _chunk_by_files(raw_content, chunk_size)
        logger.info(f"Chunked codebase into {len(chunks)} chunks (chunk_size={chunk_size}, mode={mode})")

        if log_callback:
            await log_callback("map_reduce_started", {
                "total_chunks": len(chunks),
                "message": f"Analyzing codebase across {len(chunks)} modular segments"
            })

        # MAP
        if mode == "local":
            summaries = await _map_chunks_local(chunks, log_callback)
            reduce_mode = "local"
        elif mode == "remote":
            summaries = await _map_chunks_remote(chunks, log_callback)
            reduce_mode = "remote"
        else:  # hybrid
            logger.info("[hybrid] MAP=local (Gemma), REDUCE=remote (Gemini)")
            summaries = await _map_chunks_local(chunks, log_callback)
            reduce_mode = "remote"

        # REDUCE
        logger.info(f"[REDUCE/{reduce_mode}] Synthesising {len(summaries)} chunk summaries...")
        architecture_index = await _reduce_summaries(summaries, force_mode=reduce_mode, images=extracted_images if extracted_images else None)

    # Archive the index
    try:
        upload_content(context.kb_id, "architecture_index.md", architecture_index)
    except Exception:
        pass

    return architecture_index, raw_content

