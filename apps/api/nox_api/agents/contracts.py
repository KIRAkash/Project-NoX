import logging
import re
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import InterfaceType, OrgInterfaceContract

logger = logging.getLogger(__name__)

def extract_contracts_from_compiled_files(
    app_name: str,
    kb_files: dict[str, str]
) -> list[dict[str, str]]:
    """Extract exported interface contracts from compiled knowledge-base (OKF) markdown files.
    
    Parses summaries/api-spec.md, summaries/events.md, and entities/*.md to identify
    exported REST endpoints, Kafka topics, and gRPC services with exact anchor slugs.
    """
    contracts = []

    # 1. Parse REST endpoints from summaries/api-spec.md or index.md
    api_spec = kb_files.get("summaries/api-spec.md", "") or kb_files.get("index.md", "")
    if api_spec:
        # Match markdown headers or bullet lines like: ### `POST /api/v1/auth/login` or - `GET /api/v1/users`
        endpoint_pattern = re.compile(
            r"`?\b(GET|POST|PUT|DELETE|PATCH)\s+([/a-zA-Z0-9_{}:-]+)`?",
            re.IGNORECASE
        )
        for match in endpoint_pattern.finditer(api_spec):
            method = match.group(1).upper()
            route = match.group(2).strip()
            raw_slug = f"{method.lower()}-{route}"
            anchor_slug = re.sub(r"-+", "-", re.sub(r"[^a-zA-Z0-9_-]+", "-", raw_slug)).strip("-")
            contracts.append({
                "app_name": app_name,
                "interface_type": InterfaceType.rest_endpoint,
                "identifier": route,
                "page_path": "summaries/api-spec.md" if "summaries/api-spec.md" in kb_files else "index.md",
                "anchor_slug": anchor_slug,
                "description": f"{method} {route} endpoint for {app_name}",
            })

    # 2. Parse event topics from summaries/events.md, summaries/data-flows.md, or entities/
    for path, content in kb_files.items():
        if (path.startswith("summaries/") or path.startswith("entities/") or path.startswith("concepts/")) and path.endswith(".md"):
            # Look for topics in markdown tables or bullet points: e.g. `nte.trades.matched`
            topic_matches = re.finditer(r"`([a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9._-]+)`", content)
            for tm in topic_matches:
                topic = tm.group(1).strip()
                if not topic.endswith(".md") and not topic.endswith(".py") and not topic.endswith(".js") and len(topic) > 4:
                    anchor = re.sub(r"-+", "-", re.sub(r"[^a-zA-Z0-9_-]+", "-", topic)).strip("-")
                    contracts.append({
                        "app_name": app_name,
                        "interface_type": InterfaceType.event_topic,
                        "identifier": topic,
                        "page_path": path,
                        "anchor_slug": anchor,
                        "description": f"Event stream/topic {topic} in {app_name}",
                    })

    # Deduplicate contracts by identifier + interface_type
    deduped = []
    seen = set()
    for c in contracts:
        key = (c["interface_type"], c["identifier"])
        if key not in seen:
            seen.add(key)
            deduped.append(c)

    return deduped


_KIND_TO_TYPE = {
    "rest": InterfaceType.rest_endpoint, "graphql": InterfaceType.rest_endpoint, "grpc": InterfaceType.grpc_service,
    "event": InterfaceType.event_topic, "queue": InterfaceType.event_topic, "library": InterfaceType.sdk_client,
    "db_table": InterfaceType.shared_model, "other": InterfaceType.shared_model,
}


def contracts_from_interfaces(app_name: str, interfaces: list, kb_files: dict[str, str]) -> list[dict]:
    """Typed interfaces from the cartographer → contract rows, each pointing at the page that documents it."""
    out = []
    pages = [(p, c) for p, c in kb_files.items() if p.endswith(".md") and not p.startswith(".") and p not in ("AGENTS.md", "log.md")]
    def field(i, key):
        return i.get(key) if isinstance(i, dict) else getattr(i, key, None)

    for i in interfaces:
        kind, direction = field(i, "kind"), field(i, "direction")
        ident = (field(i, "identifier") or "").strip()
        if direction != "exposes" or not ident:
            continue
        route = re.sub(r"^(GET|POST|PUT|DELETE|PATCH)\s+", "", ident, flags=re.I) if kind == "rest" else ident
        page = next((p for p, c in pages if route in c and p != "index.md"), "index.md")
        out.append({
            "app_name": app_name, "interface_type": _KIND_TO_TYPE.get(kind, InterfaceType.shared_model),
            "identifier": route, "page_path": page,
            "anchor_slug": re.sub(r"-+", "-", re.sub(r"[^a-zA-Z0-9_-]+", "-", ident.lower())).strip("-"),
            "description": (field(i, "description") or f"{ident} in {app_name}")[:300],
        })
    return out


async def register_kb_contracts(
    db: AsyncSession,
    org_id: str,
    kb_id: str,
    app_name: str,
    compiled_files: dict[str, str],
    interfaces: list | None = None,
) -> int:
    """Persist the contracts a knowledge base exposes: typed ones from the cartographer when available,
    plus whatever the compiled pages document (deduplicated)."""
    extracted = contracts_from_interfaces(app_name, interfaces or [], compiled_files)
    seen = {(c["interface_type"], c["identifier"]) for c in extracted}
    extracted += [c for c in extract_contracts_from_compiled_files(app_name, compiled_files) if (c["interface_type"], c["identifier"]) not in seen]
    if not extracted:
        logger.info(f"No exported contracts found for app {app_name}")
        return 0

    org_uuid = uuid.UUID(org_id) if isinstance(org_id, str) else org_id
    kb_uuid = uuid.UUID(kb_id) if isinstance(kb_id, str) else kb_id

    # Delete any existing contracts for this KB (to handle rebuilds/re-syncs)
    existing = await db.execute(
        select(OrgInterfaceContract).where(OrgInterfaceContract.kb_id == kb_uuid)
    )
    for row in existing.scalars().all():
        await db.delete(row)

    count = 0
    for item in extracted:
        contract = OrgInterfaceContract(
            org_id=org_uuid,
            kb_id=kb_uuid,
            app_name=app_name,
            interface_type=item["interface_type"],
            identifier=item["identifier"],
            page_path=item["page_path"],
            anchor_slug=item.get("anchor_slug"),
            description=item.get("description"),
        )
        db.add(contract)
        count += 1

    await db.commit()
    logger.info(f"✅ Registered {count} interface contracts in catalog for app {app_name}")
    return count


async def find_matching_cross_kb_contracts(
    db: AsyncSession,
    org_id: str,
    current_app_name: str,
    discovered_identifiers: list[str]
) -> list[OrgInterfaceContract]:
    """Query the org catalog for contracts matching discovered signatures across the org hierarchy."""
    if not discovered_identifiers:
        return []

    org_uuid = uuid.UUID(org_id) if isinstance(org_id, str) else org_id

    # 1. Resolve all related org IDs in the enterprise tree (self, parent, siblings, children)
    org_ids_to_search = {org_uuid}
    try:
        from ..db.models import Org
        curr_org_res = await db.execute(select(Org).where(Org.id == org_uuid))
        curr_org = curr_org_res.scalar_one_or_none()
        if curr_org:
            if curr_org.parent_org_id:
                # Add parent
                org_ids_to_search.add(curr_org.parent_org_id)
                # Add siblings (orgs sharing same parent)
                siblings_res = await db.execute(select(Org.id).where(Org.parent_org_id == curr_org.parent_org_id))
                for sib_id in siblings_res.scalars().all():
                    org_ids_to_search.add(sib_id)
            else:
                # If this is root org, add all children
                children_res = await db.execute(select(Org.id).where(Org.parent_org_id == org_uuid))
                for child_id in children_res.scalars().all():
                    org_ids_to_search.add(child_id)
    except Exception as e:
        logger.warning(f"Failed to expand org hierarchy for cross-KB query: {e}")

    # 2. Query all contracts across related orgs from OTHER applications matching identifiers
    # Join with Org to include org_slug for deterministic repository naming
    from ..db.models import Org
    result = await db.execute(
        select(OrgInterfaceContract, Org.slug.label("org_slug"))
        .join(Org, OrgInterfaceContract.org_id == Org.id)
        .where(
            OrgInterfaceContract.org_id.in_(list(org_ids_to_search)),
            OrgInterfaceContract.app_name != current_app_name,
            OrgInterfaceContract.identifier.in_(discovered_identifiers)
        )
    )
    contracts = []
    for contract_obj, org_slug in result.all():
        clean_org_slug = re.sub(r'[\s_-]+', '-', re.sub(r'[^\w\s-]', '', org_slug.lower().strip())).strip('-')
        clean_app_name = re.sub(r'[\s_-]+', '-', re.sub(r'[^\w\s-]', '', contract_obj.app_name.lower().strip())).strip('-')
        contract_obj.org_slug = org_slug
        contract_obj.repo_name = f"kb-{clean_org_slug}-{clean_app_name}"
        contracts.append(contract_obj)

    logger.info(f"🔍 Found {len(contracts)} matching cross-KB contracts across org tree ({len(org_ids_to_search)} orgs) for app {current_app_name}")
    return contracts


