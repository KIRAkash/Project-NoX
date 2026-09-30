import asyncio

from nox_api.agents.compiler import _build_cross_kb_manifest, run_synthesis_pass
from nox_api.agents.contracts import extract_contracts_from_compiled_files
from nox_api.agents.linter import check_wikilinks, run_linter
from nox_api.db.models import InterfaceType
from nox_api.services.discovery import extract_discovered_signatures, get_all_searchable_identifiers


def test_discovery_extracts_kafka_and_rest_signatures():
    raw_sample = """
    # Python FastAPI Sample
    @app.post("/api/v1/auth/login")
    async def login():
        pass
        
    @app.get("/api/v1/auth/me")
    async def get_user():
        pass

    # Kafka Stream Consumer
    logger.info("Polling messages from nte.trades.matched...")
    logger.info("Polling messages from nte.orderbook.snapshots...")
    
    # Client calls
    const res = await axios.get("http://auth-service/api/v1/users");
    """
    discovered = extract_discovered_signatures(raw_sample)
    
    assert "/api/v1/auth/login" in discovered['rest_endpoints']
    assert "/api/v1/auth/me" in discovered['rest_endpoints']
    assert "nte.trades.matched" in discovered['event_topics']
    assert "nte.orderbook.snapshots" in discovered['event_topics']
    
    searchable = get_all_searchable_identifiers(discovered)
    assert "/api/v1/auth/login" in searchable
    assert "nte.trades.matched" in searchable


def test_contracts_extracted_from_compiled_markdown():
    compiled_files = {
        "index.md": "# Order Matching Engine\n\nHigh-level architecture.",
        "summaries/api-spec.md": """
# REST API Specifications
### `POST /api/v1/orders`
Submit an order for matching.

### `GET /api/v1/orderbook`
Fetch current L2 orderbook.
        """,
        "summaries/events.md": """
# Event Feeds
- Matched trades stream published to topic `nte.trades.matched`.
- Depth updates published to `nte.orderbook.snapshots`.
        """
    }

    contracts = extract_contracts_from_compiled_files("order-matching-engine", compiled_files)
    
    identifiers = [c["identifier"] for c in contracts]
    assert "/api/v1/orders" in identifiers
    assert "/api/v1/orderbook" in identifiers
    assert "nte.trades.matched" in identifiers
    assert "nte.orderbook.snapshots" in identifiers

    # Check anchor slugs
    post_order = next(c for c in contracts if c["identifier"] == "/api/v1/orders")
    assert post_order["anchor_slug"] == "post-api-v1-orders"
    assert post_order["interface_type"] == InterfaceType.rest_endpoint

    trade_topic = next(c for c in contracts if c["identifier"] == "nte.trades.matched")
    assert trade_topic["interface_type"] == InterfaceType.event_topic


def test_build_cross_kb_manifest():
    mock_contracts = [
        {
            "app_name": "order-matching-engine",
            "page_path": "summaries/events.md",
            "anchor_slug": "matched-trades",
            "identifier": "nte.trades.matched",
            "interface_type": "event_topic",
            "repo_name": "kb-nte-order-matching-engine"
        },
        {
            "app_name": "mini-auth-service",
            "page_path": "summaries/api-spec.md",
            "anchor_slug": "login",
            "identifier": "/api/v1/auth/login",
            "interface_type": "rest_endpoint",
            "repo_name": "kb-scfs-mini-auth-service"
        }
    ]

    manifest = _build_cross_kb_manifest(mock_contracts)
    assert "[[ap:kb-nte-order-matching-engine/summaries/events#matched-trades|order-matching-engine (nte.trades.matched)]]" in manifest
    assert "[[ap:kb-scfs-mini-auth-service/summaries/api-spec#login|mini-auth-service (/api/v1/auth/login)]]" in manifest



def test_synthesis_pass_preserves_cross_kb_links():
    files = {
        "index.md": "Overview with local link [[summaries/api-spec]] and cross-link [[ap:kb-nte-order-matching-engine/summaries/events#trades|Trades Stream]].",
        "summaries/api-spec.md": "API spec referencing [[ap:kb-scfs-mini-auth-service/summaries/api-spec#login|Auth Login]].",
    }
    plan = [
        {"path": "summaries/api-spec.md", "topic": "API Specs"}
    ]

    repaired = asyncio.run(run_synthesis_pass(files, plan))
    
    assert "[[summaries/api-spec]]" in repaired["index.md"]
    assert "[[ap:kb-nte-order-matching-engine/summaries/events#trades|Trades Stream]]" in repaired["index.md"]
    assert "[[ap:kb-scfs-mini-auth-service/summaries/api-spec#login|Auth Login]]" in repaired["summaries/api-spec.md"]



def test_linter_validates_cross_kb_and_local_wikilinks():
    valid_files = {
        "index.md": """
# Application Overview
Navigation:
- [[summaries/api-spec|API Specification]]
- [[entities/processor|Processor Entity]]
- External integration: [[ap:kb-nte-order-matching-engine/summaries/events#trades|Matching Engine Feed]]
- Auth service: [[ap:kb-scfs-mini-auth-service/summaries/api-spec|Auth System]]
        """,
        "summaries/api-spec.md": """
# REST API Specifications
## Status
Operational endpoints.
### `POST /api/v1/calculate`
Calculates surveillance scores.
        """,
        "entities/processor.md": """
# Processor Component
## Responsibilities
Handles streaming calculations.
## Dependencies
Consumes [[ap:kb-nte-order-matching-engine/summaries/events|Market Feed]].
        """
    }

    issues, inbound = check_wikilinks(valid_files)
    wikilink_errors = [i for i in issues if i.severity == 'error']
    assert len(wikilink_errors) == 0, f"Expected 0 wikilink errors, got: {wikilink_errors}"

    report = run_linter(valid_files)
    assert report.is_valid is True
    assert len(report.errors) == 0


def test_linter_flags_malformed_cross_kb_link():
    invalid_files = {
        "index.md": "Invalid link: [[ap:just-app-no-path]].",
    }
    issues, _ = check_wikilinks(invalid_files)
    errors = [i for i in issues if i.severity == 'error']
    assert len(errors) == 1
    assert "Malformed cross-KB wikilink" in errors[0].message



def test_synthesis_is_idempotent():
    contracts = [{"app_name": "order-matching-engine", "repo_name": "kb-nte-order-matching-engine", "page_path": "summaries/events.md",
                  "anchor_slug": "matched-trades", "identifier": "nte.trades.matched"}]
    plan = [{"path": "summaries/api-spec.md"}, {"path": "entities/ledger.md"}]
    files = {
        "index.md": "See [[api-spec]], [[entities/ledger|the ledger]] and [[nowhere]]; trades arrive on `nte.trades.matched`.",
        "summaries/api-spec.md": "Consumes [[nte.trades.matched]] and [[ap:kb-scfs-mini-auth-service/summaries/api-spec#login|Auth Login]].",
        "entities/ledger.md": "Already linked: [[ap:kb-nte-order-matching-engine/summaries/events#matched-trades|order-matching-engine (`nte.trades.matched`)]].",
    }
    once = asyncio.run(run_synthesis_pass(dict(files), plan, candidate_contracts=contracts))
    twice = asyncio.run(run_synthesis_pass(dict(once), plan, candidate_contracts=contracts))
    assert twice == once
    link = "[[ap:kb-nte-order-matching-engine/summaries/events#matched-trades|order-matching-engine (nte.trades.matched)]]"
    assert "[[summaries/api-spec|api-spec]]" in once["index.md"] and "`nowhere`" in once["index.md"] and link in once["index.md"]
    assert link in once["summaries/api-spec.md"]  # an unknown link to a contract's identifier is woven, not left as code
    assert once["entities/ledger.md"] == files["entities/ledger.md"]  # an identifier inside a link's label is never re-wrapped
