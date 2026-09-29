import logging

from ..ai import structured
from ..ai.config import Tier
from ..ai.schemas import GatekeeperDecision
from ..core.config import settings
from .anchors import find_intersecting_anchors
from .llm_client import get_env_var

logger = logging.getLogger(__name__)

_GATEKEEPER_INSTRUCTION = """
You guard a codebase knowledge base. Classify a code diff or source delta (from GitHub, Confluence, Slack, Notion
or Jira) by whether the knowledge base must change because of it.

SIGNIFICANT: API changes, schema/data model modifications, architectural decisions, new services or features, major
dependency shifts, security changes, critical policy updates.

TRIVIAL: typos, minor comments, formatting, routine status updates, casual chat, minor copy adjustments, version bumps
in lock files.

List in affected_files the knowledge-base pages or source files the change touches.
"""

async def run_gatekeeper(
    diff: str,
    kb_files: dict[str, str] | None = None,
    ollama_url: str = None,
    model: str = None,
    local: bool | None = None,
) -> dict:
    """Classify a git diff as significant or trivial.

    Fast-Path:
      If active knowledge-base anchor tags are present in kb_files and intersect
      modified diff lines, immediately returns 'significant' with exact dirty files (0 LLM cost).

    LLM Routing:
      local  -> Gemma via Ollama (4k context — diff classification is compact)
      remote -> Gemini Flash
      hybrid -> Gemma (cheap binary decision, small context)
    """
    # 1. Deterministic Fast-Path: Check Code Anchors
    if kb_files:
        try:
            anchor_hits = find_intersecting_anchors(diff, kb_files)
            if anchor_hits:
                affected_kb_pages = sorted(list(set(hit.kb_file for hit in anchor_hits)))
                hit_reasons = "; ".join(hit.reason for hit in anchor_hits[:2])
                logger.info(f"Gatekeeper fast-path triggered on {len(anchor_hits)} anchor intersections: {hit_reasons}")
                return {
                    "decision": "significant",
                    "reason": f"Deterministic anchor hit: {hit_reasons}",
                    "affected_files": affected_kb_pages,
                    "fast_path": True,
                }
        except Exception as e:
            logger.warning(f"Anchor fast-path check failed: {e}. Falling back to LLM classifier.")

    # 2. LLM classifier (typed output: no JSON parsing)
    mode = get_env_var("AI_MODE", getattr(settings, "AI_MODE", "remote"))
    try:
        result = await structured.ask(
            GatekeeperDecision, f"Delta / changes:\n{diff[:60000]}", name="gatekeeper",
            instruction=_GATEKEEPER_INSTRUCTION, tier=Tier.FAST, local=mode in ("local", "hybrid") if local is None else local,
        )
        return {**result.model_dump(), "fast_path": False}
    except Exception as e:
        logger.error(f"Gatekeeper failed: {e}")
        return {
            "decision": "significant",
            "reason": f"Gatekeeper error — defaulting to significant: {e}",
            "affected_files": [],
            "fast_path": False,
        }
