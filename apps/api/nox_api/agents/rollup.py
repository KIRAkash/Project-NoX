import logging

from ..ai import structured
from ..ai.config import Tier
from ..ai.schemas import RollupResult

logger = logging.getLogger(__name__)

SYSTEM_ROLLUP = (
    "You are a senior software architect synthesising an organisation-level "
    "knowledge base from multiple application-level knowledge bases."
)


async def run_rollup(org_id: str, app_kbs: list, existing_org_kb: str = None) -> dict:
    """Generate or update the org-level KB by synthesising all app-level KBs.

    Always routes to remote (Gemini) regardless of AI_MODE, because rollup
    must synthesise across multiple KBs — exactly the large-context task that
    local Gemma cannot handle reliably.
    """
    content = ""
    for kb in app_kbs:
        content += f"\n\n--- App: {kb['app_name']} ---\n{kb['index']}"

    existing_hint = ""
    if existing_org_kb:
        existing_hint = (
            f"\n\nEXISTING ORG KB (update / extend this, do not discard):\n"
            f"{existing_org_kb[:8000]}"
        )

    prompt = (
        "Synthesise an org-level architecture map from these application KBs.\n\n"
        "Tasks:\n"
        "- Identify shared infrastructure, libraries, and dependencies across apps.\n"
        "- Resolve contradictions or naming inconsistencies between apps.\n"
        "- Create an org-level index that maps how apps relate to each other.\n"
        "- Use [[wikilinks]] to reference app-level concepts where helpful.\n"
        "- Return each org-level file with its path and complete Markdown; always include index.md.\n\n"
        f"Apps:\n{content}"
        f"{existing_hint}"
    )

    # Rollup always uses Gemini: it needs the widest context window available.
    logger.info(f"[rollup] Synthesising org KB for {org_id}")
    try:
        result = await structured.ask(RollupResult, prompt, name="rollup", instruction=SYSTEM_ROLLUP, tier=Tier.DEEP)
        files = {f.path: f.markdown for f in result.files if f.path and f.markdown}
        if not files:
            return {"index.md": f"# Org KB — {org_id}\n\nRollup produced an empty result."}
        return files
    except Exception as e:
        logger.error(f"Rollup failed for org {org_id}: {e}")
        return {"index.md": f"# Org KB — {org_id}\n\nRollup error: {e}"}
