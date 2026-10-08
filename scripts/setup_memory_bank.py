"""Create the Agent Platform Memory Bank that keeps NoX's team lessons (CP20). Run once per project.

    uv run --project apps/api python scripts/setup_memory_bank.py [--location global] [--dry-run]

Prints the resource name to set as NOX_MEMORY_BANK (with NOX_MEMORY=memory_bank). The bank is configured for
NoX's scopes ({"app", "seat"}), three custom topics with examples, NoX's DEFAULT-tier Gemini model for
consolidation, and gemini-embedding-2 for similarity (which needs a global, us or eu location).
The runtime service account needs roles/aiplatform.memoryUser; `scripts/deploy_gcp.sh ai-access` grants it.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps" / "api"))

from nox_api.ai.config import model_name, project  # noqa: E402
from nox_api.core.config import settings  # noqa: E402
from nox_api.services.team_memory import TOPICS  # noqa: E402

EXAMPLES = [
    ("The Product owner sent the build back: The lockout message must not reveal whether the username exists. "
     "Same text for every failed login.",
     "Login error messages never reveal whether an account exists.", "team_rule"),
    ("The Engineering lead marked it not met: Contract changed without a version bump. "
     "- The claims API stays backwards compatible: v1 clients broke.",
     "Changes to the claims API keep v1 clients working, or ship as a new version.", "quality_bar"),
]


def config(location: str) -> dict:
    p = project()
    publisher = f"projects/{p}/locations/{location}/publishers/google/models"
    return {
        "generation_config": {"model": f"{publisher}/{model_name()}"},
        "similarity_search_config": {"embedding_model": f"{publisher}/{settings.NOX_EMBED_MODEL}"},
        "unstructured_memory_configs": [{
            "scope_keys": ["app", "seat"],
            "memory_topics": [{"custom_memory_topic": {"label": label, "description": desc}} for label, desc in TOPICS.items()],
            "generate_memories_examples": [{
                "conversation_source": {"events": [{"content": {"role": "user", "parts": [{"text": said}]}}]},
                "generated_memories": [{"fact": fact, "topics": [{"custom_memory_topic_label": topic}]}],
            } for said, fact, topic in EXAMPLES],
            "consolidation_config": {"revisions_per_candidate_count": 3},
        }],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--location", default="global", help="global, us or eu (gemini-embedding-2 needs one of these)")
    ap.add_argument("--dry-run", action="store_true", help="print the configuration instead of creating the bank")
    args = ap.parse_args()
    if not project():
        print("Set GOOGLE_CLOUD_PROJECT (or GCP_PROJECT_ID) first.", file=sys.stderr)
        return 2
    cfg = config(args.location)
    if args.dry_run:
        print(json.dumps(cfg, indent=2))
        return 0
    import agentplatform

    client = agentplatform.Client(project=project(), location=args.location)
    bank = client.memory_banks.create(managed_semantic_memory_config=cfg,
                                      config={"display_name": "NoX team memory",
                                              "description": "Lessons people taught NoX, per application and seat"})
    print(f"Created {bank.name}\n\nSet these for the API and the worker:\n  NOX_MEMORY=memory_bank\n  NOX_MEMORY_BANK={bank.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
