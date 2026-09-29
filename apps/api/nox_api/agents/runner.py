import logging
import uuid
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..core.config import settings
from ..db.models import KBEvent, KBStatus, KnowledgeBase, MonitorMode, Org, OrgKB, SourceMonitor
from ..services.discovery import extract_discovered_signatures, get_all_searchable_identifiers
from ..services.gitops import (
    commit_kb_to_branch,
    open_pull_request,
    provision_kb_repo,
    provision_org_kb_repo,
    register_pr_webhook,
    register_push_webhook,
)
from ..services.pins import apply_pins
from ..services.sse import SSEManager
from . import okf
from .compiler import run_compiler
from .contracts import find_matching_cross_kb_contracts, register_kb_contracts
from .gatekeeper import run_gatekeeper
from .ingestor import run_ingestor
from .linter import lint_summary_markdown, run_linter
from .llm_client import get_env_var
from .rollup import run_rollup

logger = logging.getLogger(__name__)

@dataclass
class AgentContext:
    kb_id: str
    org_slug: str
    app_name: str
    org_id: str = ""
    ingested_content: str = ""
    raw_content: str = ""
    compiled_files: dict = None
    affected_files: list = None
    decision: Literal['significant', 'trivial', 'none'] = 'none'
    discovered_identifiers: list = None
    candidate_contracts: list = None

async def log_event(db: AsyncSession, kb_id: str, sse: SSEManager, event_type: str, payload: dict):
    kb_uuid = uuid.UUID(kb_id) if isinstance(kb_id, str) else kb_id
    event = KBEvent(kb_id=kb_uuid, event_type=event_type, payload=payload)
    db.add(event)
    await db.commit()
    await sse.broadcast(str(kb_id), {"type": event_type, "payload": payload})
    from ..services import analytics

    if analytics.enabled() and (kb := await db.get(KnowledgeBase, kb_uuid)) is not None:
        analytics.emit("kb_events", analytics.kb_event_row(kb, event))

_log_event = log_event

async def _update_kb_status(db: AsyncSession, kb: KnowledgeBase, status: KBStatus, sse: SSEManager, extra_payload: dict = None):
    kb.status = status
    await db.commit()
    payload = {"status": status.value}
    if extra_payload:
        payload.update(extra_payload)
    await log_event(db, str(kb.id), sse, "status_change", payload)

def _as_okf(kb: KnowledgeBase, files: dict[str, str], actor: str | None = None) -> dict[str, str]:
    """The files to commit as an Open Knowledge Format bundle (agents/okf.py); the stored copy is kept in step."""
    from ..ai import config
    from ..services.local_storage import load_checkpoint_json, save_checkpoint_json

    existing = load_checkpoint_json(str(kb.id), "compiled_files.json") or {}
    out = okf.to_okf(files, existing=existing, app=kb.app_name, repo_url=kb.git_repo_url,
                     actor=actor or f"nox/{config.model_name()}", source_repo=okf.source_repo_of(kb))
    save_checkpoint_json(str(kb.id), "compiled_files.json", {**existing, **out})
    return out


async def _index_for_search(db: AsyncSession, kb: KnowledgeBase, sse: SSEManager):
    """Refresh the KB's search index from its compiled checkpoint; only changed sections are re-embedded."""
    from ..services.local_storage import load_checkpoint_json
    from ..services.search import index_kb_safely

    files = load_checkpoint_json(str(kb.id), "compiled_files.json") or {}
    stats = await index_kb_safely(kb.id, files) if files else None
    if stats:
        await log_event(db, str(kb.id), sse, "search_indexed", {
            "chunks": stats.chunks, "embedded": stats.embedded, "unchanged": stats.unchanged,
            "message": f"Search index updated: {stats.embedded} of {stats.chunks} sections embedded",
        })

async def run_generation_pipeline(kb_id: str, db: AsyncSession, sse: SSEManager):
    kb_uuid = uuid.UUID(kb_id) if isinstance(kb_id, str) else kb_id
    kb = await db.get(KnowledgeBase, kb_uuid)
    if not kb:
        logger.error(f"KnowledgeBase {kb_id} not found")
        return
    org = await db.get(Org, kb.org_id)
    if not org:
        logger.error(f"Org not found for KB {kb_id}")
        return
    
    tokens = {
        'GITHUB_APP_TOKEN': settings.GITHUB_APP_TOKEN,
        'CONFLUENCE_API_TOKEN': settings.CONFLUENCE_API_TOKEN,
        'NOTION_API_TOKEN': settings.NOTION_API_TOKEN,
        'JIRA_API_TOKEN': settings.JIRA_API_TOKEN
    }

    try:
        # ── Step 1: Ingestion ──────────────────────────────────────────────
        await _update_kb_status(db, kb, KBStatus.ingesting, sse)
        active_ai_mode = get_env_var("AI_MODE", getattr(settings, "AI_MODE", "remote"))
        await _log_event(db, str(kb.id), sse, "pipeline_started", {
            "status": "ingesting",
            "message": "Pipeline initiated: Ingestion and architecture analysis started",
        })

        context = AgentContext(
            kb_id=str(kb.id),
            org_slug=org.slug,
            app_name=kb.app_name,
            org_id=str(org.id),
        )

        async def ingest_log_cb(event_type: str, payload: dict):
            try:
                from ..workers.db_session import get_db_sync
                async with get_db_sync() as event_db:
                    await _log_event(event_db, str(kb.id), sse, event_type, payload)
            except Exception as err:
                logger.warning(f"Failed to log event {event_type}: {err}")

        use_agents = settings.NOX_KB_BUILDER != "classic"
        if use_agents:
            # NoX's agent team maps and writes the KB from the raw snapshot (ai/agents/kb_builder.py).
            from ..services.local_storage import load_kb_content
            from .ingestor import gather_sources

            raw_content = load_kb_content(str(kb.id), "raw_ingest.txt") or await gather_sources(context, kb.source_urls, tokens, ingest_log_cb)
            ingested_summary = ""
        else:
            ingested_summary, raw_content = await run_ingestor(context, kb.source_urls, tokens, log_callback=ingest_log_cb)
        context.ingested_content = ingested_summary
        context.raw_content = raw_content

        # Automated Cross-Repository Discovery Scanner
        discovered = extract_discovered_signatures(raw_content)
        discovered_identifiers = get_all_searchable_identifiers(discovered)
        context.discovered_identifiers = discovered_identifiers

        # Query existing Org Interface Contracts for candidate connections
        candidate_contracts = await find_matching_cross_kb_contracts(
            db, str(org.id), kb.app_name, discovered_identifiers
        )
        context.candidate_contracts = candidate_contracts

        await _log_event(db, str(kb.id), sse, "ingestion_complete", {
            "discovered_signatures": len(discovered_identifiers),
            "matched_cross_kbs": len(candidate_contracts),
            "message": f"Ingestion complete: Discovered {len(discovered_identifiers)} interface contracts ({len(candidate_contracts)} cross-app links matched)",
        })

        # ── Step 2: Compilation ────────────────────────────────────────────
        await _update_kb_status(db, kb, KBStatus.generating, sse)
        await _log_event(db, str(kb.id), sse, "compilation_started", {
            "matched_cross_kbs": len(candidate_contracts),
            "message": f"Synthesis phase: writing knowledge-base pages ({len(candidate_contracts)} cross-app connections identified)",
        })

        async def compile_log_cb(event_type: str, payload: dict):
            try:
                from ..workers.db_session import get_db_sync
                async with get_db_sync() as event_db:
                    await _log_event(event_db, str(kb.id), sse, event_type, payload)
            except Exception as err:
                logger.warning(f"Failed to log event {event_type}: {err}")

        interfaces = None
        if use_agents:
            from ..ai.agents import kb_builder
            from ..services.local_storage import load_checkpoint_json

            compiled_files = load_checkpoint_json(str(kb.id), "compiled_files.json")
            if not (compiled_files and "index.md" in compiled_files and len(compiled_files) > 1):
                compiled_files, amap = await kb_builder.build(context, raw_content, log=compile_log_cb)
                interfaces = amap.interfaces
                from ..ai.config import model_name

                kb.built_with = f"cloud:{model_name()}"
            else:
                amap = load_checkpoint_json(str(kb.id), "architecture_map.json") or {}
                interfaces = amap.get("interfaces")
        else:
            compiled_files = await run_compiler(context, log_callback=compile_log_cb)
        context.compiled_files = compiled_files
        await _log_event(db, str(kb.id), sse, "compilation_complete", {
            "file_count": len(compiled_files),
            "message": f"Compilation complete: {len(compiled_files)} knowledge-base pages written (Open Knowledge Format)",
        })

        # ── Step 2.5: Register exported interface contracts into Org Catalog ─
        registered_count = await register_kb_contracts(
            db, str(org.id), str(kb.id), kb.app_name, compiled_files, interfaces=interfaces
        )
        await _log_event(db, str(kb.id), sse, "contracts_registered", {
            "registered_contracts": registered_count,
            "message": f"Registered {registered_count} interface contracts into Organization Catalog",
        })
        await _index_for_search(db, kb, sse)


        # ── Step 3: GitOps — provision repo ───────────────────────────────
        github_org = org.github_org or settings.GITHUB_DEFAULT_ORG
        repo_url = provision_kb_repo(org.slug, kb.app_name, github_org)
        repo_full_name = "/".join(repo_url.rstrip("/").split("/")[-2:])
        kb.git_repo_url = repo_url
        await db.commit()
        await _log_event(db, str(kb.id), sse, "repo_provisioned", {
            "repo_url": repo_url,
            "message": "Knowledge Base repository provisioned on GitHub",
        })

        # ── Step 4: Commit to feature branch ──────────────────────────────
        feature_branch = "kb/initial-generation"
        await apply_pins(db, kb.id, compiled_files)
        compiled_files = _as_okf(kb, compiled_files)
        commit_kb_to_branch(repo_full_name, feature_branch, compiled_files)

        # ── Step 5: Open PR to main ────────────────────────────────────────
        pr_url = open_pull_request(
            repo_full_name,
            feature_branch,
            f"🚀 Initial knowledge base (Open Knowledge Format): {kb.app_name}",
            (
                f"Automated knowledge base generated by **NoX**.\n\n"
                f"**Application:** `{kb.app_name}`\n"
                f"**Org:** `{org.slug}`\n\n"
                f"The knowledge base is an Open Knowledge Format (OKF {okf.OKF_VERSION}) bundle. Review it and merge to publish."
                + lint_summary_markdown(run_linter(compiled_files))
            )
        )
        kb.pr_url = pr_url
        
        # Register a webhook on the KB repo itself to listen for PR merges
        try:
            register_pr_webhook(
                repo_full_name,
                f"{settings.WEBHOOK_BASE_URL}/api/webhooks/github/pr"
            )
        except Exception as e:
            logger.warning(f"Could not register PR webhook for KB repo {repo_full_name}: {e}")
            
        await db.commit()
        await _log_event(db, str(kb.id), sse, "pr_opened", {
            "pr_url": pr_url,
            "message": "Pull Request opened for review and publishing",
        })

        # ── Step 6: Register monitors for all configured sources (Flow B) ─
        for source in (kb.source_urls or []):
            s_type = source.get('type') if isinstance(source, dict) else getattr(source, 'type', 'github')
            s_url = source.get('url') if isinstance(source, dict) else getattr(source, 'url', '')
            s_incr = source.get('incremental_enabled', True) if isinstance(source, dict) else getattr(source, 'incremental_enabled', True)
            s_config = source.get('config', {}) if isinstance(source, dict) else getattr(source, 'config', {})

            if not s_url:
                continue

            webhook_id = None
            monitor_mode = MonitorMode.polling

            if s_type == 'github' and settings.SOURCE_MONITOR_MODE == 'webhook':
                repo_name = "/".join(s_url.rstrip("/").split("/")[-2:])
                try:
                    webhook_id = register_push_webhook(
                        repo_name,
                        f"{settings.WEBHOOK_BASE_URL}/api/webhooks/github/push"
                    )
                    monitor_mode = MonitorMode.webhook
                except Exception as e:
                    logger.warning(f"Could not register webhook for {s_url}: {e}. Falling back to polling monitor.")
                    monitor_mode = MonitorMode.polling

            monitor = SourceMonitor(
                kb_id=kb.id,
                source_type=s_type,
                repo_url=s_url,
                source_url=s_url,
                webhook_id=webhook_id,
                last_commit_sha=None,
                last_sync_state={},
                config=s_config or {},
                incremental_enabled=s_incr,
                monitor_mode=monitor_mode,
            )
            db.add(monitor)

        await db.commit()

        # ── Step 7: Status → in_review ─────────────────────────────────────
        await _update_kb_status(db, kb, KBStatus.in_review, sse, {"pr_url": pr_url})

    except Exception as e:
        logger.exception(f"Generation pipeline failed for KB {kb_id}: {e}")
        await _update_kb_status(db, kb, KBStatus.failed, sse, {"error": str(e)})
        await _log_event(db, str(kb.id), sse, "pipeline_error", {"error": str(e)})


async def run_gatekeeper_pipeline(
    kb_id: str,
    diff: str,
    db: AsyncSession,
    sse: SSEManager,
    commit_sha: str = None,
    commit_message: str = None,
    source_type: str = "github",
    source_url: str = None,
    affected_items: list = None,
    author: str = None,
    summary: str = None,
):
    """Flow B: Gatekeeper → conditional patch compilation → new PR."""
    kb_uuid = uuid.UUID(kb_id) if isinstance(kb_id, str) else kb_id
    kb = await db.get(KnowledgeBase, kb_uuid)
    if not kb:
        logger.error(f"KnowledgeBase {kb_id} not found for gatekeeper pipeline")
        return

    org = await db.get(Org, kb.org_id)
    org_slug = org.slug if org else "default"

    try:
        logger.info(f"🛡️ [Gatekeeper] Starting evaluation for KB {kb.app_name} (Source: {source_type})")
        await _log_event(db, str(kb.id), sse, "gatekeeper_evaluation_started", {
            "message": f"Analyzing changes from {source_type.upper()} for {kb.app_name}",
            "source_type": source_type,
            "source_url": source_url,
            "commit_sha": commit_sha,
            "commit_message": commit_message,
            "summary": summary,
        })

        # ── Gatekeeper classification ──────────────────────────────────────
        # Pass the current KB pages so anchored code ranges can decide deterministically before any LLM call.
        from ..services.local_storage import load_checkpoint_json
        kb_files = load_checkpoint_json(str(kb.id), "compiled_files.json") or None
        decision = await run_gatekeeper(diff, kb_files=kb_files)
        logger.info(f"🛡️ [Gatekeeper] Classification: {decision.get('decision', '').upper()} | Reason: {decision.get('reason')}")

        event_payload = {
            "decision": decision['decision'],
            "reason": decision['reason'],
            "affected_files": decision.get('affected_files', []) or (affected_items or []),
            "source_type": source_type,
            "source_url": source_url,
            "commit_sha": commit_sha,
            "commit_message": commit_message,
            "summary": summary,
            "message": f"Gatekeeper [{source_type.upper()}]: {decision['decision'].upper()} — {decision['reason']}",
        }
        await _log_event(db, str(kb.id), sse, f"gatekeeper_{decision['decision']}", event_payload)

        if decision['decision'] == 'trivial':
            logger.info(f"🛡️ Gatekeeper blocked update for KB {kb_id}: {decision['reason']}")
            await _log_event(db, str(kb.id), sse, "gatekeeper_block", {
                "message": f"Update skipped: {decision['reason']}",
                "decision": "trivial",
                "source_type": source_type,
            })
            return

        # ── Significant change: patch compile affected files ───────────────
        logger.info(f"🌟 [Patch Compilation] Starting patch compilation for {kb.app_name}...")
        await _update_kb_status(db, kb, KBStatus.generating, sse, {"trigger": "sync_patch"})
        await _log_event(db, str(kb.id), sse, "patch_compilation_started", {
            "message": f"Compiling documentation updates for significant change: {decision['reason']}",
            "affected_files": decision.get('affected_files', []),
            "source_type": source_type,
        })

        context = AgentContext(
            kb_id=str(kb.id),
            org_slug=org_slug,
            app_name=kb.app_name,
            ingested_content=f"Source: {source_type.upper()} ({source_url or 'N/A'})\n\nChanges / Delta:\n{diff}",
            affected_files=decision.get('affected_files', []),
            decision="significant",
        )

        patch_files = await run_compiler(context, patch_files=decision.get('affected_files'))
        logger.info(f"🌟 [Patch Compilation] Successfully compiled {len(patch_files)} updated KB files")

        if org:
            await register_kb_contracts(db, str(org.id), str(kb.id), kb.app_name, patch_files)
        await _index_for_search(db, kb, sse)

        await _log_event(db, str(kb.id), sse, "patch_compiled", {
            "file_count": len(patch_files),
            "files": list(patch_files.keys()),
            "message": f"Compiled {len(patch_files)} documentation files for patch",
            "source_type": source_type,
        })

        # ── Commit patch to new branch → open PR ──────────────────────────
        repo_full_name = "/".join(kb.git_repo_url.rstrip("/").split("/")[-2:])
        branch_suffix = commit_sha[:7] if commit_sha else uuid.uuid4().hex[:7]
        branch = f"kb/sync-{source_type}-{branch_suffix}"

        logger.info(f"📦 [GitOps] Committing patch to branch {branch} in {repo_full_name}...")
        await apply_pins(db, kb.id, patch_files)
        patch_files = _as_okf(kb, patch_files)
        commit_kb_to_branch(repo_full_name, branch, patch_files)

        source_label = source_type.capitalize()
        summary_label = summary or commit_message or branch_suffix
        pr_title = f"🔄 KB Sync [{source_label}]: {kb.app_name} ({summary_label[:40]})"
        pr_body = (
            f"### 🌌 NoX Automated KB Sync\n\n"
            f"**Gatekeeper** detected a significant change from **{source_label}**.\n\n"
            f"- **Source:** `{source_type}` ({source_url or 'configured source'})\n"
            f"- **Reason:** {decision['reason']}\n"
            f"- **Author / Trigger:** `{author or 'System'}`\n"
            f"- **Summary:** {summary or commit_message or 'Incremental change detected'}\n"
            f"- **Affected Files / Items:** {', '.join(decision.get('affected_files', []) or (affected_items or ['All']))}\n"
            f"- **Updated KB Pages:** {', '.join(patch_files.keys())}\n\n"
            f"Please review the updated documentation and merge to publish."
        )

        logger.info(f"🚀 [GitOps] Opening PR on {repo_full_name}...")
        pr_url = open_pull_request(repo_full_name, branch, pr_title, pr_body)
        kb.pr_url = pr_url
        await db.commit()

        await _log_event(db, str(kb.id), sse, "pr_opened", {
            "pr_url": pr_url,
            "branch": branch,
            "source_type": source_type,
            "message": f"Pull Request opened for sync: {pr_url}",
        })
        await _update_kb_status(db, kb, KBStatus.in_review, sse, {"pr_url": pr_url, "trigger": "sync"})
        logger.info(f"✅ [Gatekeeper Pipeline] Complete! PR opened at: {pr_url}")

    except Exception as e:
        logger.exception(f"❌ Gatekeeper pipeline failed for KB {kb_id}: {e}")
        await _update_kb_status(db, kb, KBStatus.failed, sse, {"error": str(e)})
        await _log_event(db, str(kb.id), sse, "pipeline_error", {"error": str(e)})



async def run_rollup_pipeline(org_id: str, db: AsyncSession, sse: SSEManager):
    """Flow C: Read all published app KBs in org → Rollup Agent → Org KB repo PR."""
    org = await db.get(Org, org_id)
    if not org:
        return

    try:
        # ── Fetch all published app KBs for this org ───────────────────────
        result = await db.execute(
            select(KnowledgeBase)
            .where(KnowledgeBase.org_id == org_id, KnowledgeBase.status == KBStatus.published)
            .options(selectinload(KnowledgeBase.events))
        )
        published_kbs = result.scalars().all()

        if len(published_kbs) < 2:
            logger.info(f"Rollup skipped for org {org_id}: fewer than 2 published KBs")
            return

        # ── Build app KB content list for rollup agent ─────────────────────
        from ..services.gcs import download_content
        app_kbs = []
        for kb in published_kbs:
            index_content = ""
            if kb.gcs_archive_path:
                try:
                    index_content = download_content(f"{kb.gcs_archive_path}/index.md")
                except Exception:
                    index_content = f"# {kb.app_name}\n\nContent unavailable."
            app_kbs.append({"app_name": kb.app_name, "index": index_content})

        # ── Check for existing org KB ─────────────────────────────────────
        org_kb_result = await db.execute(select(OrgKB).where(OrgKB.org_id == org_id))
        existing_org_kb_record = org_kb_result.scalars().first()
        existing_content = None
        if existing_org_kb_record and existing_org_kb_record.git_repo_url:
            try:
                existing_content = download_content(f"org-kbs/{org_id}/index.md")
            except Exception:
                pass

        # ── Run Rollup Agent ───────────────────────────────────────────────
        org_files = await run_rollup(org_id, app_kbs, existing_content)
        logger.info(f"Rollup generated {len(org_files)} files for org {org_id}")

        # ── GitOps: provision org repo if needed ──────────────────────────
        github_org = org.github_org or settings.GITHUB_DEFAULT_ORG
        if existing_org_kb_record and existing_org_kb_record.git_repo_url:
            org_repo_url = existing_org_kb_record.git_repo_url
        else:
            org_repo_url = provision_org_kb_repo(org.slug, github_org)

        org_repo_full_name = "/".join(org_repo_url.rstrip("/").split("/")[-2:])
        branch = f"kb/rollup-{org_id[:8]}"
        from ..ai import config

        org_files = okf.to_okf(org_files, app=f"org-{org.slug}", repo_url=org_repo_url, actor=f"nox/{config.model_name(config.Tier.DEEP)}")
        commit_kb_to_branch(org_repo_full_name, branch, org_files)
        org_pr_url = open_pull_request(
            org_repo_full_name,
            branch,
            f"🌐 Org KB Rollup: {org.name}",
            (
                f"**Org-level knowledge base** updated by **NoX Rollup Agent**.\n\n"
                f"**Org:** `{org.name}`\n"
                f"**Contributing apps:** {', '.join([k['app_name'] for k in app_kbs])}\n\n"
                f"Review and merge to publish the updated org architecture map."
                + lint_summary_markdown(run_linter(org_files))
            )
        )

        # ── Persist OrgKB record ───────────────────────────────────────────
        if existing_org_kb_record:
            existing_org_kb_record.git_repo_url = org_repo_url
            existing_org_kb_record.pr_url = org_pr_url
            existing_org_kb_record.status = KBStatus.in_review
            existing_org_kb_record.trigger_count = len(published_kbs)
        else:
            new_org_kb = OrgKB(
                org_id=org_id,
                git_repo_url=org_repo_url,
                pr_url=org_pr_url,
                status=KBStatus.in_review,
                trigger_count=len(published_kbs),
            )
            db.add(new_org_kb)

        # Update org_pr_url on all contributing KBs
        for kb in published_kbs:
            kb.org_pr_url = org_pr_url
        await db.commit()

        logger.info(f"Rollup complete for org {org_id}: PR at {org_pr_url}")

        # ── Bubble up to parent org if applicable ─────────────────────────
        if org.parent_org_id:
            parent_published = await db.execute(
                select(KnowledgeBase).where(
                    KnowledgeBase.org_id == org.parent_org_id,
                    KnowledgeBase.status == KBStatus.published
                )
            )
            if len(parent_published.scalars().all()) >= 2:
                await run_rollup_pipeline(str(org.parent_org_id), db, sse)

    except Exception as e:
        logger.exception(f"Rollup pipeline failed for org {org_id}: {e}")

async def run_add_source_pipeline(kb_id: str, source: dict, db: AsyncSession, sse: SSEManager):
    """Flow D: Add a new source to a published KB incrementally."""
    kb_uuid = uuid.UUID(kb_id) if isinstance(kb_id, str) else kb_id
    kb = await db.get(KnowledgeBase, kb_uuid)
    if not kb:
        logger.error(f"KnowledgeBase {kb_id} not found for add-source pipeline")
        return

    org = await db.get(Org, kb.org_id)
    org_slug = org.slug if org else "default"
    
    source_type = source.get("type", "github")
    source_url = source.get("url", "")
    config = source.get("config", {})
    
    tokens = {
        'GITHUB_APP_TOKEN': settings.GITHUB_APP_TOKEN,
        'CONFLUENCE_API_TOKEN': settings.CONFLUENCE_API_TOKEN,
        'NOTION_API_TOKEN': settings.NOTION_API_TOKEN,
        'JIRA_API_TOKEN': settings.JIRA_API_TOKEN
    }

    try:
        logger.info(f"🌟 [Add Source] Starting incremental pipeline for {kb.app_name} ({source_url})")
        await _log_event(db, str(kb.id), sse, "pipeline_started", {
            "message": f"Ingesting new source: {source_url}",
            "source_type": source_type,
            "source_url": source_url,
        })
        
        # 1. Ingest new source
        from ..services.local_storage import load_checkpoint_json
        from .coverage_diff import run_coverage_diff
        from .ingestor import run_ingestor
        
        context = AgentContext(
            kb_id=str(kb.id),
            org_slug=org_slug,
            app_name=kb.app_name,
            org_id=str(kb.org_id),
        )
        
        async def ingest_log_cb(event_type: str, payload: dict):
            try:
                from ..workers.db_session import get_db_sync
                async with get_db_sync() as event_db:
                    await _log_event(event_db, str(kb.id), sse, event_type, payload)
            except Exception:
                pass
                
        # We simulate the source as a list of 1 to reuse run_ingestor
        ingested_summary, raw_content = await run_ingestor(context, [source], tokens, log_callback=ingest_log_cb)
        context.ingested_content = ingested_summary
        
        # 2. Load existing KB files
        cached_compiled = load_checkpoint_json(str(kb.id), "compiled_files.json") or {}
        
        if not cached_compiled:
            logger.warning(f"No existing KB files found for {kb.app_name}, this might not be published yet.")
            
        # 3. Coverage diff
        await _log_event(db, str(kb.id), sse, "diff_checked", {
            "message": "Analyzing coverage of new source against existing KB...",
            "source_type": source_type
        })
        
        diff_result = await run_coverage_diff(
            app_name=kb.app_name,
            existing_kb_files=cached_compiled,
            new_source_content=raw_content,
            source_type=source_type,
            source_url=source_url,
            org_slug=org_slug
        )
        
        logger.info(f"🌟 [Add Source] Coverage diff: is_fully_covered={diff_result['is_fully_covered']}, reason={diff_result['reason']}")
        
        if diff_result["is_fully_covered"]:
            # Exit early, no PR needed
            await _log_event(db, str(kb.id), sse, "gatekeeper_trivial", {
                "message": f"Source is fully covered by existing KB. No PR needed. Reason: {diff_result['reason']}",
                "source_type": source_type,
            })
            return
            
        # 4. Patch compilation
        affected_files = diff_result["pages_to_create"] + diff_result["pages_to_update"]
        context.affected_files = affected_files
        context.decision = "significant"
        # We need to simulate the diff text for the patch compiler
        context.ingested_content = f"New Source Add ({source_type.upper()}): {source_url}\n\nContent:\n{raw_content[:40000]}"
        
        await _update_kb_status(db, kb, KBStatus.generating, sse, {"trigger": "add_source"})
        await _log_event(db, str(kb.id), sse, "patch_compilation_started", {
            "message": f"Compiling updates for new source. Affected files: {len(affected_files)}",
            "affected_files": affected_files,
            "source_type": source_type,
        })
        
        from .compiler import run_compiler
        patch_files = await run_compiler(context, patch_files=affected_files)
        
        if org:
            await register_kb_contracts(db, str(org.id), str(kb.id), kb.app_name, patch_files)
        await _index_for_search(db, kb, sse)

        await _log_event(db, str(kb.id), sse, "patch_compiled", {
            "file_count": len(patch_files),
            "files": list(patch_files.keys()),
            "message": f"Compiled {len(patch_files)} documentation files for new source",
            "source_type": source_type,
        })
        
        # 5. Commit & PR
        repo_full_name = "/".join(kb.git_repo_url.rstrip("/").split("/")[-2:]) if kb.git_repo_url else f"org/kb-{kb.app_name}"
        branch_suffix = uuid.uuid4().hex[:7]
        branch = f"kb/add-source-{source_type}-{branch_suffix}"
        
        await apply_pins(db, kb.id, patch_files)
        patch_files = _as_okf(kb, patch_files)
        commit_kb_to_branch(repo_full_name, branch, patch_files)
        
        pr_title = f"🚀 New Source Added: {source_type.capitalize()} for {kb.app_name}"
        pr_body = (
            f"### 🌌 NoX Add Source Pipeline\n\n"
            f"A new source was added to the Knowledge Base:\n\n"
            f"- **Source:** `{source_type}` ({source_url})\n"
            f"- **Analysis:** {diff_result['reason']}\n"
            f"- **New Pages:** {', '.join(diff_result['pages_to_create']) or 'None'}\n"
            f"- **Updated Pages:** {', '.join(diff_result['pages_to_update']) or 'None'}\n\n"
            f"Please review the incremental documentation updates and merge to publish."
        )
        
        pr_url = open_pull_request(repo_full_name, branch, pr_title, pr_body)
        kb.pr_url = pr_url
        await db.commit()
        
        await _log_event(db, str(kb.id), sse, "pr_opened", {
            "pr_url": pr_url,
            "branch": branch,
            "source_type": source_type,
            "message": f"Pull Request opened for new source: {pr_url}",
        })
        
        await _update_kb_status(db, kb, KBStatus.in_review, sse, {"pr_url": pr_url, "trigger": "add_source"})
        
    except Exception as e:
        logger.exception(f"❌ Add source pipeline failed for KB {kb_id}: {e}")
        # Revert status if we changed it, or just emit error
        await _update_kb_status(db, kb, KBStatus.failed, sse, {"error": str(e)})
        await _log_event(db, str(kb.id), sse, "pipeline_error", {"error": str(e)})



async def run_local_publish(kb_id: str, files: dict[str, str], meta: dict, db: AsyncSession, sse: SSEManager) -> dict:
    """NoX Local: pages built on a developer's machine with Gemma arrive as Markdown only. NoX checks them,
    registers their contracts, indexes them for search and opens the KB pull request, exactly as for a cloud
    build, but never sees the source code."""
    from ..services.local_storage import load_checkpoint_json, save_checkpoint_json

    kb = await db.get(KnowledgeBase, uuid.UUID(str(kb_id)))
    org = await db.get(Org, kb.org_id)
    model = str(meta.get("model") or "gemma").removeprefix("ollama_chat/").removeprefix("ollama/")
    mode = "sync" if meta.get("mode") == "sync" else "build"
    commit = str(meta.get("commit") or "")[:7]

    compiled = dict(files)
    if mode == "sync":  # a sync carries only the pages that changed
        compiled = {**(load_checkpoint_json(str(kb.id), "compiled_files.json") or {}), **files}
    save_checkpoint_json(str(kb.id), "compiled_files.json", compiled)
    kb.built_with = f"local:{model}"
    await db.commit()
    await log_event(db, str(kb.id), sse, "local_pages_received", {
        "pages": len(files), "model": model, "mode": mode, "commit": commit, "provenance": "local",
        "message": f"{len(files)} pages built locally with {model}: the source never left the developer's machine",
    })

    lint = run_linter(compiled)
    registered = await register_kb_contracts(db, str(org.id), str(kb.id), kb.app_name, compiled, interfaces=meta.get("interfaces"))
    await _index_for_search(db, kb, sse)

    github_org = org.github_org or settings.GITHUB_DEFAULT_ORG
    if not kb.git_repo_url:
        kb.git_repo_url = provision_kb_repo(org.slug, kb.app_name, github_org)
        await db.commit()
    repo_full_name = "/".join(kb.git_repo_url.rstrip("/").split("/")[-2:])
    branch = f"kb/local-{mode}-{commit or uuid.uuid4().hex[:7]}"
    await apply_pins(db, kb.id, files)
    files = _as_okf(kb, files, actor=f"nox-local/{model}")
    lint = run_linter({**compiled, **files})
    commit_kb_to_branch(repo_full_name, branch, files)
    pr_url = open_pull_request(
        repo_full_name, branch,
        f"{'🔄' if mode == 'sync' else '🚀'} KB {'sync' if mode == 'sync' else 'build'} (local · {model}): {kb.app_name}",
        (f"Built on a developer's machine by **NoX Local** with **{model}** (Gemma via Ollama). "
         f"The source code never left that machine; NoX received only these {len(files)} Markdown pages.\n\n"
         f"- **Application:** `{kb.app_name}`\n- **Commit:** `{commit or 'n/a'}`\n- **Contracts registered:** {registered}\n\n"
         "Review and merge to publish." + lint_summary_markdown(lint)),
    )
    kb.pr_url = pr_url
    await db.commit()
    await log_event(db, str(kb.id), sse, "pr_opened", {"pr_url": pr_url, "branch": branch, "provenance": "local",
                                                       "message": f"Pull Request opened for locally built pages: {pr_url}"})
    await _update_kb_status(db, kb, KBStatus.in_review, sse, {"pr_url": pr_url, "trigger": f"local_{mode}"})
    return {"pr_url": pr_url, "pages": len(files), "contracts": registered, "lint_errors": len(lint.errors)}
