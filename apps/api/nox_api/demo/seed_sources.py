"""Seed the Tidewell demo's external sources: Confluence spaces, Jira projects, Slack channels, Notion pages.

Everything comes from demo/tidewell/estate.yaml and the files under demo/tidewell/sources/. It is
idempotent: spaces, projects, components and channels are created only if missing; pages are updated
in place by title; issues are skipped by summary; a channel that already has messages is left alone.
Notion pages and Slack channel ids are written to demo/tidewell/.seeded.json for seed_org.

Creating Jira projects and Confluence spaces needs admin rights on the site. When the token lacks
them, the seeder says which ones to create by hand and carries on with the rest.

Run from apps/api:  uv run python -m nox_api.demo.seed_sources [--only confluence|jira|slack|notion]
"""

import argparse
import asyncio
import json
import logging
import urllib.parse

import httpx
import markdown

from ..core.config import settings
from ..integrations import atlassian
from ..integrations.jira import JiraClient, JiraError
from . import estate
from .notion_blocks import markdown_to_notion_blocks

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("demo-sources")

FORCE_SLACK = False
MANUAL: list[str] = []  # steps a person has to do, printed at the end


# ── Confluence ──────────────────────────────────────────────────────────────────

async def _ensure_space(client: httpx.AsyncClient, domain: str, headers: dict, key: str, name: str) -> bool:
    r = await client.get(f"{domain}/wiki/rest/api/space/{key}", headers=headers)
    if r.status_code == 200:
        return True
    payload = {"key": key, "name": name, "description": {"plain": {"value": f"{name} (Tidewell Mutual)", "representation": "plain"}}}
    c = await client.post(f"{domain}/wiki/rest/api/space", headers=headers, json=payload)
    if c.status_code in (200, 201):
        logger.info(f"✅ Created Confluence space {key}")
        return True
    logger.warning(f"Could not create Confluence space {key}: {c.status_code} {c.text[:200]}")
    MANUAL.append(f"Create Confluence space key={key} name='{name}', then re-run with --only confluence")
    return False


async def _upsert_page(client: httpx.AsyncClient, domain: str, headers: dict, key: str, title: str, html: str) -> str | None:
    q = urllib.parse.quote(title)
    found = await client.get(f"{domain}/wiki/rest/api/content?title={q}&spaceKey={key}&expand=version", headers=headers)
    results = found.json().get("results", []) if found.status_code == 200 else []
    body = {"storage": {"value": html, "representation": "storage"}}
    if results:
        page = results[0]
        payload = {"id": page["id"], "type": "page", "title": title, "space": {"key": key}, "body": body,
                   "version": {"number": page.get("version", {}).get("number", 1) + 1}}
        r = await client.put(f"{domain}/wiki/rest/api/content/{page['id']}", headers=headers, json=payload)
        page_id = page["id"]
    else:
        r = await client.post(f"{domain}/wiki/rest/api/content", headers=headers,
                              json={"type": "page", "title": title, "space": {"key": key}, "body": body})
        page_id = r.json().get("id") if r.status_code in (200, 201) else None
    if r.status_code not in (200, 201):
        logger.warning(f"Failed to write page '{title}' in {key}: {r.status_code} {r.text[:200]}")
        return None
    logger.info(f"✅ {key}: {title}")
    return f"{domain}/wiki/spaces/{key}/pages/{page_id}"


async def seed_confluence(m: dict) -> None:
    token = settings.CONFLUENCE_API_TOKEN or settings.JIRA_API_TOKEN
    if not token or not settings.ATLASSIAN_BASE_URL:
        logger.warning("⏭️ Skipping Confluence: CONFLUENCE_API_TOKEN or ATLASSIAN_BASE_URL not set")
        return
    domain = atlassian.base_url()
    headers = {**atlassian.json_headers(token), "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        for key, space in m["confluence_spaces"].items():
            if not await _ensure_space(client, domain, headers, key, space["name"]):
                continue
            for f in sorted((estate.ESTATE_DIR / space["folder"]).glob("*.md")):
                md = f.read_text()
                html = markdown.markdown(estate.page_body(md), extensions=["tables", "fenced_code"])
                await _upsert_page(client, domain, headers, key, estate.page_title(md, f.stem), html)


# ── Jira ────────────────────────────────────────────────────────────────────────

async def _ensure_project(jira: JiraClient, key: str, name: str, lead: str) -> bool:
    try:
        await jira._request("GET", f"/rest/api/3/project/{key}")
        return True
    except JiraError:
        pass
    try:
        await jira._request("POST", "/rest/api/3/project", json={
            "key": key, "name": name, "leadAccountId": lead, "projectTypeKey": "software",
            "projectTemplateKey": "com.pyxis.greenhopper.jira:gh-simplified-kanban-classic",
            "assigneeType": "UNASSIGNED"})
        logger.info(f"✅ Created Jira project {key}")
        return True
    except JiraError as e:
        logger.warning(f"Could not create Jira project {key}: {e}")
        MANUAL.append(f"Create Jira project key={key} name='{name}' (Kanban, company-managed), then re-run with --only jira")
        return False


async def _ensure_components(jira: JiraClient, key: str, names: set[str]) -> None:
    have = {c["name"] for c in await jira._request("GET", f"/rest/api/3/project/{key}/components")}
    for n in sorted(names - have):
        try:
            await jira._request("POST", "/rest/api/3/component", json={"name": n, "project": key})
        except JiraError as e:
            logger.warning(f"Component {n} in {key}: {e}")


async def seed_jira(m: dict) -> None:
    if not settings.JIRA_API_TOKEN or not settings.ATLASSIAN_BASE_URL:
        logger.warning("⏭️ Skipping Jira: JIRA_API_TOKEN or ATLASSIAN_BASE_URL not set")
        return
    issues = json.loads((estate.ESTATE_DIR / "sources" / "jira" / "issues.json").read_text())["issues"]
    async with JiraClient() as jira:
        lead = (await jira.myself())["accountId"]
        ready = {k for k, p in m["jira_projects"].items() if await _ensure_project(jira, k, p["name"], lead)}
        for key in ready:
            await _ensure_components(jira, key, {c for i in issues if i["project"] == key for c in i.get("components", [])})

        existing: dict[str, str] = {}
        for key in ready:
            for i in await jira.search(f"project = {key}", fields=["summary"], limit=1000):
                existing[i["fields"]["summary"]] = i["key"]
        refs: dict[str, str] = {}
        # Epics first, so stories can point at them.
        for issue in sorted(issues, key=lambda i: i["type"] != "Epic"):
            if issue["project"] not in ready:
                continue
            key = existing.get(issue["summary"])
            if not key:
                extra = {"components": [{"name": c} for c in issue.get("components", [])]}
                parent = refs.get(issue.get("epic", ""))
                try:
                    created = await jira.create_issue(issue["project"], issue["summary"], issue["description"],
                                                      issue["type"], labels=["tidewell-demo"], parent_key=parent, extra_fields=extra)
                except JiraError:
                    created = await jira.create_issue(issue["project"], issue["summary"], issue["description"],
                                                      issue["type"], labels=["tidewell-demo"], extra_fields=extra)
                key = created["key"]
                logger.info(f"✅ {key}: {issue['summary']}")
            if issue.get("ref"):
                refs[issue["ref"]] = key
            if issue.get("status") and issue["status"] != "To Do":
                try:
                    await jira.transition_to(key, issue["status"])
                except JiraError as e:
                    logger.warning(f"{key} → {issue['status']}: {e}")


# ── Slack ───────────────────────────────────────────────────────────────────────

async def _slack(client: httpx.AsyncClient, method: str, token: str, **kw) -> dict:
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8"}
    r = await (client.get(f"https://slack.com/api/{method}", headers=headers, params=kw) if method.endswith((".list", ".history"))
               else client.post(f"https://slack.com/api/{method}", headers=headers, json=kw))
    return r.json()


async def seed_slack(m: dict) -> None:
    token = settings.SLACK_BOT_TOKEN
    if not token:
        logger.warning("⏭️ Skipping Slack: SLACK_BOT_TOKEN not set")
        return
    ids: dict[str, str] = {}
    async with httpx.AsyncClient(timeout=30.0) as client:
        listed = await _slack(client, "conversations.list", token, types="public_channel", limit=1000, exclude_archived="true")
        by_name = {c["name"]: c["id"] for c in listed.get("channels", [])}
        for name in m["slack_channels"]:
            data = json.loads((estate.ESTATE_DIR / "sources" / "slack" / f"{name}.json").read_text())
            cid = by_name.get(name)
            if not cid:
                made = await _slack(client, "conversations.create", token, name=name)
                cid = made.get("channel", {}).get("id")
                if not cid:
                    logger.warning(f"Could not create #{name}: {made.get('error')}")
                    MANUAL.append(f"Create Slack channel #{name}, invite the NoX bot, then re-run with --only slack")
                    continue
                logger.info(f"✅ Created #{name}")
            await _slack(client, "conversations.join", token, channel=cid)
            if data.get("purpose"):
                await _slack(client, "conversations.setPurpose", token, channel=cid, purpose=data["purpose"])
            ids[name] = cid
            history = await _slack(client, "conversations.history", token, channel=cid, limit=20)
            posted = [x for x in history.get("messages", []) if not x.get("subtype")]  # ignore joins and purpose changes
            if posted and not FORCE_SLACK:
                logger.info(f"ℹ️ #{name} already has messages, skipping (use --force-slack to post again)")
                continue
            for msg in data["messages"]:
                parent = await _slack(client, "chat.postMessage", token, channel=cid, text=f"*{msg['user']}*: {msg['text']}")
                for reply in msg.get("replies", []):
                    await _slack(client, "chat.postMessage", token, channel=cid, thread_ts=parent.get("ts"),
                                 text=f"*{reply['user']}*: {reply['text']}")
            logger.info(f"✅ #{name}: {len(data['messages'])} threads")
    estate.write_lock({"slack": {n: f"https://slack.com/archives/{c}" for n, c in ids.items()}})


# ── Notion ──────────────────────────────────────────────────────────────────────

async def seed_notion(m: dict) -> None:
    token, parent = settings.NOTION_API_TOKEN, (settings.NOTION_PARENT_PAGE_ID or "").replace("-", "")
    if not token or len(parent) < 32:
        logger.warning("⏭️ Skipping Notion: NOTION_API_TOKEN or NOTION_PARENT_PAGE_ID not set")
        return
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Notion-Version": "2022-06-28"}

    async def children_by_title(client: httpx.AsyncClient, page_id: str) -> dict[str, str]:
        r = await client.get(f"https://api.notion.com/v1/blocks/{page_id}/children", headers=headers, params={"page_size": 100})
        return {b["child_page"]["title"]: b["id"] for b in r.json().get("results", []) if b.get("type") == "child_page"}

    async def create(client: httpx.AsyncClient, under: str, title: str, md: str) -> str | None:
        blocks = markdown_to_notion_blocks(md)
        r = await client.post("https://api.notion.com/v1/pages", headers=headers, json={
            "parent": {"page_id": under}, "properties": {"title": {"title": [{"text": {"content": title}}]}},
            "children": blocks[:100]})
        if r.status_code not in (200, 201):
            logger.warning(f"Notion page '{title}': {r.status_code} {r.text[:200]}")
            return None
        page_id = r.json()["id"]
        for i in range(100, len(blocks), 100):
            await client.patch(f"https://api.notion.com/v1/blocks/{page_id}/children", headers=headers, json={"children": blocks[i:i + 100]})
        logger.info(f"✅ Notion: {title}")
        return page_id

    urls: dict[str, str] = {}
    async with httpx.AsyncClient(timeout=30.0) as client:
        root_title = m["company"]["name"]
        root = (await children_by_title(client, parent)).get(root_title) or await create(
            client, parent, root_title, f"Product and research pages for {root_title}, the NoX demo company.")
        if not root:
            MANUAL.append("Share the Notion parent page with the NoX integration, then re-run with --only notion")
            return
        have = await children_by_title(client, root)
        for slug, path in m["notion_pages"].items():
            md = (estate.ESTATE_DIR / path).read_text()
            title = estate.page_title(md, slug)
            page_id = have.get(title) or await create(client, root, title, estate.page_body(md))
            if page_id:
                urls[slug] = f"https://www.notion.so/{page_id.replace('-', '')}"
    estate.write_lock({"notion": urls})


async def main() -> None:
    global FORCE_SLACK
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", choices=["confluence", "jira", "slack", "notion"], action="append")
    parser.add_argument("--force-slack", action="store_true")
    args = parser.parse_args()
    FORCE_SLACK = args.force_slack
    wanted = args.only or ["confluence", "jira", "slack", "notion"]
    m = estate.load()
    steps = {"confluence": seed_confluence, "jira": seed_jira, "slack": seed_slack, "notion": seed_notion}
    for name in wanted:
        try:
            await steps[name](m)
        except (JiraError, httpx.HTTPError, atlassian.AtlassianConfigError) as e:
            logger.error(f"❌ {name} failed: {e}")
    if MANUAL:
        print("\nDo these by hand, then re-run:\n" + "\n".join(f"  - {s}" for s in MANUAL))


if __name__ == "__main__":
    asyncio.run(main())
