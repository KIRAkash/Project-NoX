import logging
from typing import Any

from ..ai import structured
from ..ai.schemas import CoverageDiff
from ..core.config import settings
from .digest import generate_architecture_digest
from .llm_client import get_env_var

logger = logging.getLogger(__name__)

SYSTEM_COVERAGE_DIFF = (
    "You are a technical documentation architect. Your task is to analyze new source code/content "
    "and compare it against the existing Knowledge Base (KB) architecture digest. "
    "Identify what is genuinely new and needs to be documented, versus what is already covered."
)

async def run_coverage_diff(
    app_name: str,
    existing_kb_files: dict,
    new_source_content: str,
    source_type: str,
    source_url: str,
    org_slug: str = "org"
) -> dict[str, Any]:
    """
    Determines which parts of the new source content are NOT already
    documented in the existing KB.
    """
    
    # 1. Generate the digest of the existing KB
    kb_digest = generate_architecture_digest(app_name, org_slug, existing_kb_files)
    
    # 2. Prepare the prompt
    prompt = (
        f"We are adding a new source to the existing Knowledge Base for '{app_name}'.\n\n"
        f"--- EXISTING KB DIGEST ---\n"
        f"{kb_digest}\n\n"
        f"--- NEW SOURCE ({source_type.upper()}: {source_url}) ---\n"
        f"{new_source_content[:25000]}\n\n"
        f"INSTRUCTIONS:\n"
        f"1. Compare the new source content against the existing KB digest.\n"
        f"2. Identify any significant topics, components, or logic in the new source that are NOT already covered.\n"
        f"3. Propose new KB pages to create (e.g., 'entities/new-service.md') OR existing pages to update (e.g., 'summaries/api-spec.md').\n"
        f"4. If the new source is completely redundant or trivial, set 'is_fully_covered' to true.\n"
        f"5. In 'reason', briefly explain what is new or why it is fully covered.\n"
    )

    mode = get_env_var("AI_MODE", getattr(settings, "AI_MODE", "remote"))

    try:
        result = await structured.ask(CoverageDiff, prompt, name="coverage_diff", instruction=SYSTEM_COVERAGE_DIFF,
                                      local=mode == "local")
        return result.model_dump()
    except Exception as e:
        logger.error(f"Coverage diff failed or returned invalid JSON: {e}")
        # Conservative fallback: Assume not covered, update index and a new source page.
        return {
            "pages_to_create": [f"sources/{source_type}-{source_url.split('/')[-1]}.md"],
            "pages_to_update": ["index.md"],
            "is_fully_covered": False,
            "reason": f"Fallback due to LLM error: {str(e)}"
        }
