"""Seed the demo's external sources — Confluence, Jira, Notion, Slack — for the Apex Trading platform.

Idempotent: pages and issues that already exist (by title / summary) are skipped, and Slack threads
are only posted into an empty channel. Run from apps/api:  uv run python -m nox_api.demo.seed_sources
"""

import argparse
import asyncio
import json
import logging
import os
import re
import urllib.parse
from pathlib import Path

import httpx
import markdown

from ..core.config import settings
from ..integrations import atlassian
from ..integrations.jira import JiraClient, JiraError

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("demo-seeder")

BASE_DIR = Path(__file__).resolve().parents[4] / "demo" / "sources"
FORCE_SLACK = False

async def seed_confluence():
    """Seed Confluence Space with complete architecture documentation and ADRs rendered in rich HTML."""
    token = settings.CONFLUENCE_API_TOKEN or settings.JIRA_API_TOKEN
    if not token or not settings.ATLASSIAN_BASE_URL:
        logger.warning("⏭️ Skipping Confluence: CONFLUENCE_API_TOKEN or ATLASSIAN_BASE_URL not set")
        return None
    domain = atlassian.base_url()
    headers = {**atlassian.json_headers(token), "Content-Type": "application/json"}
    space_key = os.getenv("CONFLUENCE_SPACE_KEY", "APEX")

    pages_to_create = [
        ("Space Overview: Apex Trading & Settlement Platform", (BASE_DIR / "confluence" / "space-overview.md").read_text()),
        ("ADR-001: In-Memory B-Tree Orderbook with Write-Ahead Journaling", (BASE_DIR / "confluence" / "adr-001-in-memory-orderbook.md").read_text()),
        ("ADR-002: Event-Driven Double-Entry Trade Settlement via Kafka", (BASE_DIR / "confluence" / "adr-002-event-driven-settlement.md").read_text()),
        ("ADR-003: High-Throughput TimescaleDB Range Partitioning & Compression", (BASE_DIR / "confluence" / "adr-003-postgres-partitioning.md").read_text()),
        ("ADR-004: Market Data Gateway Streaming with Protocol Buffers and WebSockets", (BASE_DIR / "confluence" / "adr-004-market-data-protobuf.md").read_text()),
        ("ADR-005: Real-Time Anomaly & Market Abuse Surveillance Architecture", (BASE_DIR / "confluence" / "adr-005-realtime-surveillance.md").read_text()),
        ("ADR-006: Distributed API Key Authentication & HMAC Signatures", (BASE_DIR / "confluence" / "adr-006-hmac-distributed-auth.md").read_text()),
        ("Runbook: Matching Engine Failover & Disaster Recovery Protocol", (BASE_DIR / "confluence" / "runbook-failover-disaster-recovery.md").read_text()),
    ]

    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Resolve numeric spaceId using Confluence v2 API or v1 API
        space_id = None
        r_v2 = await client.get(f"{domain}/wiki/api/v2/spaces?keys={space_key}", headers=headers)
        if r_v2.status_code == 200:
            results = r_v2.json().get("results", [])
            if results:
                space_id = results[0].get("id")
                logger.info(f"Found Confluence space '{space_key}' with numeric ID: {space_id}")

        # If not found via v2, check v1 space endpoint or create space
        if not space_id:
            r_v1 = await client.get(f"{domain}/wiki/rest/api/space/{space_key}", headers=headers)
            if r_v1.status_code != 200:
                logger.info(f"Confluence space '{space_key}' not found. Attempting to create it...")
                create_space_payload = {
                    "key": space_key,
                    "name": f"{space_key} Architecture & Settlement",
                    "description": {
                        "plain": {
                            "value": "Enterprise Documentation for Apex Trading Platform",
                            "representation": "plain"
                        }
                    }
                }
                c_res = await client.post(f"{domain}/wiki/rest/api/space", headers=headers, json=create_space_payload)
                if c_res.status_code in (200, 201):
                    logger.info(f"✅ Created Confluence space: {space_key}")
                else:
                    logger.warning(f"Could not auto-create Confluence space '{space_key}': {c_res.status_code} {c_res.text}")

        # 2. Convert markdown to rich HTML storage format and Create/Update pages
        created_urls = []
        for title, md_content in pages_to_create:
            # Convert markdown to compliant XHTML/HTML storage format
            html_body = markdown.markdown(md_content, extensions=['tables', 'fenced_code', 'nl2br'])
            page_done = False

            # Check if page already exists via v1 API to get ID and version
            encoded_title = urllib.parse.quote(title)
            check_res = await client.get(f"{domain}/wiki/rest/api/content?title={encoded_title}&spaceKey={space_key}&expand=version", headers=headers)
            existing_page = None
            if check_res.status_code == 200:
                results = check_res.json().get("results", [])
                if results:
                    existing_page = results[0]

            if existing_page:
                page_id = existing_page.get("id")
                version_num = existing_page.get("version", {}).get("number", 1)
                update_payload = {
                    "id": page_id,
                    "type": "page",
                    "title": title,
                    "space": {"key": space_key},
                    "body": {
                        "storage": {
                            "value": html_body,
                            "representation": "storage"
                        }
                    },
                    "version": {
                        "number": version_num + 1
                    }
                }
                u_res = await client.put(f"{domain}/wiki/rest/api/content/{page_id}", headers=headers, json=update_payload)
                if u_res.status_code in (200, 201):
                    page_url = f"{domain}/wiki/spaces/{space_key}/pages/{page_id}"
                    created_urls.append(page_url)
                    logger.info(f"✅ Updated Confluence Page (rich HTML): {title} -> {page_url}")
                    page_done = True
                else:
                    logger.warning(f"Failed to update page '{title}': {u_res.status_code} {u_res.text}")

            if not page_done:
                # Try v2 API if space_id exists
                if space_id:
                    payload_v2 = {
                        "spaceId": str(space_id),
                        "title": title,
                        "body": {
                            "representation": "storage",
                            "value": html_body
                        }
                    }
                    res_v2 = await client.post(f"{domain}/wiki/api/v2/pages", headers=headers, json=payload_v2)
                    if res_v2.status_code in (200, 201):
                        page_data = res_v2.json()
                        page_url = f"{domain}/wiki/spaces/{space_key}/pages/{page_data.get('id')}"
                        created_urls.append(page_url)
                        logger.info(f"✅ Created Confluence Page (v2): {title} -> {page_url}")
                        page_done = True

                if not page_done:
                    payload_v1 = {
                        "type": "page",
                        "title": title,
                        "space": {"key": space_key},
                        "body": {
                            "storage": {
                                "value": html_body,
                                "representation": "storage"
                            }
                        }
                    }
                    res_v1 = await client.post(f"{domain}/wiki/rest/api/content", headers=headers, json=payload_v1)
                    if res_v1.status_code in (200, 201):
                        page_data = res_v1.json()
                        page_id = page_data.get("id")
                        page_url = f"{domain}/wiki/spaces/{space_key}/pages/{page_id}"
                        created_urls.append(page_url)
                        logger.info(f"✅ Created Confluence Page (v1): {title} -> {page_url}")
                    else:
                        logger.warning(f"Failed to create page '{title}': {res_v1.status_code} {res_v1.text}")

        space_url = f"{domain}/wiki/spaces/{space_key}"
        logger.info(f"🎉 Confluence Space Ready: {space_url}")
        return space_url

async def seed_jira():
    """Create the APEX backlog (epics, stories, tasks) in Jira, skipping summaries that already exist."""
    if not settings.JIRA_API_TOKEN or not settings.ATLASSIAN_BASE_URL:
        logger.warning("⏭️ Skipping Jira: JIRA_API_TOKEN or ATLASSIAN_BASE_URL not set")
        return None
    project_key = settings.JIRA_DEFAULT_PROJECT
    data = json.loads((BASE_DIR / "jira" / "jira_epics_and_stories.json").read_text())
    async with JiraClient() as jira:
        existing = {i["fields"].get("summary", "") for i in await jira.search(f"project = {project_key}", fields=["summary"], limit=1000)}
        for issue in data.get("issues", []):
            if issue["summary"] in existing:
                logger.info(f"ℹ️ Jira issue already exists: {issue['summary']}")
                continue
            try:
                created = await jira.create_issue(project_key, issue["summary"], issue["description"], "Task", labels=["nox-demo"])
                logger.info(f"✅ Created Jira issue {created['key']}: {issue['summary']}")
            except JiraError as e:
                logger.warning(f"Failed to create Jira issue '{issue['summary']}': {e}")
        url = f"{jira.base_url}/jira/projects/{project_key}"
    logger.info(f"🎉 Jira project ready: {url}")
    return url


def parse_notion_rich_text(text: str):
    if not text:
        return []
    # Tokenize bold (**...**), code (`...`), and normal text
    tokens = []
    pattern = re.compile(r'(\*\*.*?\*\*|`.*?`|[^\*`]+)')
    for match in pattern.finditer(text):
        chunk = match.group(0)
        if chunk.startswith('**') and chunk.endswith('**') and len(chunk) >= 4:
            tokens.append({
                "type": "text",
                "text": {"content": chunk[2:-2]},
                "annotations": {"bold": True}
            })
        elif chunk.startswith('`') and chunk.endswith('`') and len(chunk) >= 2:
            tokens.append({
                "type": "text",
                "text": {"content": chunk[1:-1]},
                "annotations": {"code": True}
            })
        else:
            tokens.append({
                "type": "text",
                "text": {"content": chunk}
            })
    return tokens or [{"type": "text", "text": {"content": text}}]

def markdown_to_notion_blocks(md_text: str):
    """Convert Markdown string to Notion native block objects."""
    blocks = []
    lines = md_text.strip().split('\n')
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue

        # Check divider
        if line in ('---', '***', '___'):
            blocks.append({
                "object": "block",
                "type": "divider",
                "divider": {}
            })
            i += 1
            continue

        # Check Headings
        if line.startswith('### '):
            blocks.append({
                "object": "block",
                "type": "heading_3",
                "heading_3": {"rich_text": parse_notion_rich_text(line[4:].strip())}
            })
            i += 1
            continue
        elif line.startswith('## '):
            blocks.append({
                "object": "block",
                "type": "heading_2",
                "heading_2": {"rich_text": parse_notion_rich_text(line[3:].strip())}
            })
            i += 1
            continue
        elif line.startswith('# '):
            blocks.append({
                "object": "block",
                "type": "heading_1",
                "heading_1": {"rich_text": parse_notion_rich_text(line[2:].strip())}
            })
            i += 1
            continue

        # Check Bullet Lists
        if line.startswith(('- ', '* ')):
            blocks.append({
                "object": "block",
                "type": "bulleted_list_item",
                "bulleted_list_item": {"rich_text": parse_notion_rich_text(line[2:].strip())}
            })
            i += 1
            continue

        # Check Numbered List
        num_match = re.match(r'^\d+\.\s+(.*)', line)
        if num_match:
            blocks.append({
                "object": "block",
                "type": "numbered_list_item",
                "numbered_list_item": {"rich_text": parse_notion_rich_text(num_match.group(1).strip())}
            })
            i += 1
            continue

        # Check Table
        if line.startswith('|') and line.endswith('|'):
            table_lines = []
            while i < len(lines) and lines[i].strip().startswith('|') and lines[i].strip().endswith('|'):
                tline = lines[i].strip()
                # Skip separator lines like |---|---|
                if not re.match(r'^\|(\s*[-:]+\s*\|)+$', tline):
                    table_lines.append(tline)
                i += 1

            if table_lines:
                rows_data = []
                for tl in table_lines:
                    cols = [c.strip() for c in tl.strip('|').split('|')]
                    rows_data.append(cols)

                max_cols = max(len(r) for r in rows_data) if rows_data else 1
                table_rows_blocks = []
                for r in rows_data:
                    padded_r = r + [''] * (max_cols - len(r))
                    row_cells = [parse_notion_rich_text(cell) for cell in padded_r]
                    table_rows_blocks.append({
                        "type": "table_row",
                        "table_row": {"cells": row_cells}
                    })

                blocks.append({
                    "object": "block",
                    "type": "table",
                    "table": {
                        "table_width": max_cols,
                        "has_column_header": True,
                        "has_row_header": False,
                        "children": table_rows_blocks
                    }
                })
            continue

        # Default: paragraph block
        blocks.append({
            "object": "block",
            "type": "paragraph",
            "paragraph": {"rich_text": parse_notion_rich_text(line)}
        })
        i += 1

    return blocks

async def seed_notion():
    """Seed Notion workspace with PRD, Data Dictionary, and Security Matrix rendered in native Notion blocks."""
    token = settings.NOTION_API_TOKEN
    parent_page_id = settings.NOTION_PARENT_PAGE_ID or ""

    if not token or not parent_page_id:
        logger.warning("⏭️ Skipping Notion: NOTION_API_TOKEN or NOTION_PARENT_PAGE_ID not set in .env")
        return None

    # Extract clean 32-character hex UUID from any Notion URL / string format
    clean_hex = parent_page_id.replace("-", "").strip()
    match = re.search(r"([0-9a-fA-F]{32})", clean_hex)
    if match:
        raw_hex = match.group(1)
        clean_parent_id = f"{raw_hex[0:8]}-{raw_hex[8:12]}-{raw_hex[12:16]}-{raw_hex[16:20]}-{raw_hex[20:32]}"
    else:
        clean_parent_id = parent_page_id

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28"
    }

    documents_to_seed = [
        ("Apex Institutional Trading Platform - Product Requirements Document", (BASE_DIR / "notion" / "product-requirements-doc.md").read_text()),
        ("Enterprise Data Dictionary & Storage Topology", (BASE_DIR / "notion" / "database-dictionary.md").read_text()),
        ("Security, Compliance & Regulatory Architecture Matrix", (BASE_DIR / "notion" / "security-and-compliance-matrix.md").read_text()),
    ]

    last_url = None
    async with httpx.AsyncClient(timeout=30.0) as client:
        existing: dict[str, str] = {}
        kids = await client.get(f"https://api.notion.com/v1/blocks/{clean_parent_id}/children", headers=headers, params={"page_size": 100})
        for block in kids.json().get("results", []) if kids.status_code == 200 else []:
            if block.get("type") == "child_page":
                existing[block["child_page"].get("title", "")] = block["id"]
        for title, md_content in documents_to_seed:
            if title in existing:
                last_url = f"https://www.notion.so/{existing[title].replace('-', '')}"
                logger.info(f"ℹ️ Notion page already exists: {title}")
                continue
            children_blocks = markdown_to_notion_blocks(md_content)
            payload = {
                "parent": {"page_id": clean_parent_id},
                "properties": {
                    "title": {
                        "title": [{"text": {"content": title}}]
                    }
                },
                "children": children_blocks[:100]  # Notion limit per request
            }
            res = await client.post("https://api.notion.com/v1/pages", headers=headers, json=payload)
            if res.status_code in (200, 201):
                created_id = res.json().get("id")
                notion_url = res.json().get("url", f"https://notion.so/{created_id.replace('-', '')}")
                logger.info(f"✅ Created Notion Page (native blocks): {title} -> {notion_url}")
                last_url = notion_url
            else:
                logger.warning(f"Failed to create Notion page '{title}': {res.status_code} {res.text}")

        return last_url

async def seed_slack():
    """Seed Slack channel with realistic engineering architecture threads."""
    token = settings.SLACK_BOT_TOKEN
    channel_name = os.getenv("SLACK_CHANNEL_NAME", "apexpay-architecture")

    if not token:
        logger.warning("⏭️ Skipping Slack: SLACK_BOT_TOKEN not set in .env")
        return None

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8"}
    slack_data_path = BASE_DIR / "slack" / "channel_architecture.json"
    data = json.loads(slack_data_path.read_text())

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Create or join channel
        c_res = await client.post("https://slack.com/api/conversations.create", headers=headers, json={"name": channel_name})
        c_data = c_res.json()
        channel_id = c_data.get("channel", {}).get("id")

        if not channel_id:
            # Channel might already exist; search for it across channels
            list_res = await client.get(
                "https://slack.com/api/conversations.list",
                headers=headers,
                params={"types": "public_channel,private_channel", "limit": 1000}
            )
            data_channels = list_res.json().get("channels", [])
            for ch in data_channels:
                if ch.get("name") == channel_name or ch.get("name_normalized") == channel_name:
                    channel_id = ch.get("id")
                    break

        if not channel_id:
            # Fallback to conversations.list without types filter
            list_res = await client.get("https://slack.com/api/conversations.list", headers=headers)
            for ch in list_res.json().get("channels", []):
                if ch.get("name") == channel_name or ch.get("name_normalized") == channel_name:
                    channel_id = ch.get("id")
                    break

        if not channel_id:
            logger.warning(f"Could not find or create Slack channel #{channel_name}: {c_data.get('error')}")
            return None

        # Join the channel if needed
        await client.post("https://slack.com/api/conversations.join", headers=headers, json={"channel": channel_id})

        history = (await client.get("https://slack.com/api/conversations.history", headers=headers,
                                    params={"channel": channel_id, "limit": 1})).json()
        if history.get("messages") and not FORCE_SLACK:
            logger.info(f"ℹ️ #{channel_name} already has messages — skipping (use --force-slack to post again)")
            return f"https://slack.com/archives/{channel_id}"
        logger.info(f"Posting architecture threads to Slack #{channel_name} ({channel_id})...")

        for msg in data.get("messages", []):
            p_res = await client.post("https://slack.com/api/chat.postMessage", headers=headers, json={
                "channel": channel_id,
                "text": f"*{msg['user']}*: {msg['text']}"
            })
            p_data = p_res.json()
            parent_ts = p_data.get("ts")

            # Post replies in thread
            for reply in msg.get("replies", []):
                await client.post("https://slack.com/api/chat.postMessage", headers=headers, json={
                    "channel": channel_id,
                    "thread_ts": parent_ts,
                    "text": f"*{reply['user']}*: {reply['text']}"
                })

        slack_url = f"https://slack.com/archives/{channel_id}"
        logger.info(f"🎉 Slack Channel Ready: {slack_url}")
        return slack_url

async def main():
    global FORCE_SLACK
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", choices=["confluence", "jira", "notion", "slack"], action="append")
    parser.add_argument("--force-slack", action="store_true")
    args = parser.parse_args()
    FORCE_SLACK = args.force_slack
    wanted = set(args.only or ["confluence", "jira", "notion", "slack"])

    logger.info("🚀 Seeding demo sources…")
    urls = {}
    for name, fn in [("confluence", seed_confluence), ("jira", seed_jira), ("notion", seed_notion), ("slack", seed_slack)]:
        if name in wanted:
            try:
                urls[name] = await fn()
            except (JiraError, httpx.HTTPError, atlassian.AtlassianConfigError) as e:
                logger.error(f"❌ {name} failed: {e}")
                urls[name] = None
    print("\n" + "=" * 70)
    print(f"GitHub org:  https://github.com/{settings.GITHUB_DEFAULT_ORG}")
    for name, url in urls.items():
        print(f"{name:11}  {url or 'not seeded — see log above'}")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
