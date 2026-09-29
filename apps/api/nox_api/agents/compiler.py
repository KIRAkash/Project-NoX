import asyncio
import json
import logging
import re
from typing import Literal

from ..ai import structured
from ..ai.schemas import PagePatch
from ..core.config import settings
from ..services.local_storage import (
    load_checkpoint_json,
    load_kb_content,
    save_checkpoint_json,
    upload_content,
)
from .anchors import generate_anchor_tag
from .digest import generate_architecture_digest
from .linter import run_linter
from .llm_client import get_env_var, llm_client

logger = logging.getLogger(__name__)

SYSTEM_COMPILER = (
    "You are a technical documentation compiler generating a codebase wiki. "
    "Use Obsidian-compatible [[wikilinks]] to cross-reference other pages listed "
    "in the KB manifest provided in each prompt."
)


# ---------------------------------------------------------------------------
# Hybrid routing helper
# ---------------------------------------------------------------------------

def _route_page(path: str) -> Literal["local", "remote"]:
    """Determine which model should compile a given KB page.

    In local/remote modes, routing is uniform. In hybrid mode, pages are
    routed by their directory category based on HYBRID_*_CATEGORIES config.
    """
    mode = get_env_var("AI_MODE", getattr(settings, "AI_MODE", "remote"))
    if mode == "local":
        return "local"
    if mode == "remote":
        return "remote"
    # hybrid
    category = path.split("/")[0]
    local_cats = [c.strip() for c in settings.HYBRID_LOCAL_CATEGORIES.split(",")]
    if category in local_cats:
        return "local"
    return "remote"


# ---------------------------------------------------------------------------
# Context filtering helper
# ---------------------------------------------------------------------------

def _filter_raw_code(raw: str, topic: str, max_chars: int = 25000) -> str:
    """Return the most topic-relevant files from raw content, up to max_chars.

    In local mode the budget is tight; callers pass a smaller max_chars.
    """
    parts = re.split(r'--- FILE: (.*?) ---', raw)
    if len(parts) <= 1:
        return raw[:max_chars]

    file_map = {parts[i]: parts[i + 1].strip() for i in range(1, len(parts), 2)}
    topic_words = set(re.findall(r'\w+', topic.lower()))

    scored = []
    for path, content in file_map.items():
        score = sum(1 for w in topic_words if w in path.lower() or w in content.lower())
        scored.append((score, path, content))
    scored.sort(reverse=True, key=lambda x: x[0])

    filtered = ""
    for _, path, content in scored:
        if len(filtered) >= max_chars:
            break
        filtered += f"\n--- FILE: {path} ---\n{content}"
    return filtered


# ---------------------------------------------------------------------------
# Page manifest builder (zero LLM cost)
# ---------------------------------------------------------------------------

def _build_manifest(plan: list) -> str:
    """Build a wikilink manifest from the documentation plan.

    Example output:
      [[index]] - High-level architecture overview
      [[summaries/api-spec]] - REST API endpoints and request/response schemas
    """
    lines = ["[[index]] - High-level architecture overview of this application"]
    for page in plan:
        path = page.get("path", "")
        topic = page.get("topic", "")
        wikilink = path.replace(".md", "")
        lines.append(f"[[{wikilink}]] - {topic}")
    return "\n".join(lines)


def _build_cross_kb_manifest(candidate_contracts: list) -> str:
    """Build a cross-KB wikilink manifest from matched contracts in other applications.

    Example output:
      - [[ap:kb-nte-order-matching-engine/summaries/events#matched-trades|Order Matching Engine (nte.trades.matched)]]
    """
    if not candidate_contracts:
        return ""
    lines = ["\n\nCROSS-APPLICATION KNOWLEDGE BASE DIRECTORY (Use [[ap:<target-repo>/<path>|<label>]] when referencing these external systems):"]
    for c in candidate_contracts:
        app = getattr(c, "app_name", "") if not isinstance(c, dict) else c.get("app_name", "")
        repo = getattr(c, "repo_name", "") if not isinstance(c, dict) else c.get("repo_name", "")
        org_slug = getattr(c, "org_slug", "") if not isinstance(c, dict) else c.get("org_slug", "")
        path = getattr(c, "page_path", "") if not isinstance(c, dict) else c.get("page_path", "")
        anchor = getattr(c, "anchor_slug", "") if not isinstance(c, dict) else c.get("anchor_slug", "")
        ident = getattr(c, "identifier", "") if not isinstance(c, dict) else c.get("identifier", "")
        itype = getattr(c, "interface_type", "") if not isinstance(c, dict) else c.get("interface_type", "")

        if not repo:
            clean_app = re.sub(r'[\s_-]+', '-', re.sub(r'[^\w\s-]', '', app.lower().strip())).strip('-')
            if org_slug:
                clean_org = re.sub(r'[\s_-]+', '-', re.sub(r'[^\w\s-]', '', org_slug.lower().strip())).strip('-')
                repo = f"kb-{clean_org}-{clean_app}"
            else:
                repo = f"kb-{clean_app}"

        clean_path = path.replace(".md", "")
        link_target = f"ap:{repo}/{clean_path}"
        if anchor:
            link_target += f"#{anchor}"
        lines.append(f"- [[{link_target}|{app} ({ident})]] - {itype}: {ident}")
    return "\n".join(lines)


def _generate_agents_contract(app_name: str, org_slug: str) -> str:
    """Generate root AGENTS.md contract for external AI coding tools."""
    return (
        f"# AGENTS.md — how to use this knowledge base\n\n"
        f"This repository is the knowledge base for **{org_slug}/{app_name}**, maintained by NoX. It is an "
        f"**Open Knowledge Format (OKF) bundle**, following Google Cloud's open specification for knowledge that agents "
        f"and people share (https://github.com/GoogleCloudPlatform/open-knowledge-format), extended by NoX for "
        f"knowledge that spans applications.\n\n"
        f"## Layout\n"
        f"- `index.md`: the architectural overview; its frontmatter declares `okf_version`, and it ends with the contents.\n"
        f"- `summaries/`: interface and API references (e.g. `api-spec.md`).\n"
        f"- `concepts/`: flows, lifecycles and cross-cutting mechanisms.\n"
        f"- `entities/`: components, services and data models.\n"
        f"- `decisions/`: architecture decision records (ADRs).\n"
        f"- `*/index.md`: each folder's pages with their one-line descriptions (OKF progressive disclosure).\n"
        f"- `log.md`: every generation and sync, grouped by date, newest first.\n"
        f"- `.nox/brief.md`: a compact brief (under 4,000 characters) for coding agents.\n\n"
        f"## Rules for agents\n"
        f"1. **Frontmatter**: every page starts with OKF YAML frontmatter. `type` is required; `title`, `description`, "
        f"`resource`, `tags`, `sources` and `generated` describe the page. Keep any keys you don't recognise.\n"
        f"2. **Links**: pages link with `[[path/slug|Title]]` wikilinks, and to other applications' knowledge bases with "
        f"`[[kb:other-app/path|Title]]` (NoX's cross-application extension). Folder indexes use OKF's bundle-absolute "
        f"Markdown links (`/entities/x.md`).\n"
        f"3. **Log changes**: when you change or add a page, add an entry to `log.md` under today's date.\n"
        f"4. **Preserve anchors**: never delete `<!-- anchor: ... -->` comments; they tie a page to the source lines it describes.\n"
    )


def _generate_log_timeline(app_name: str, initial_sha: str = "") -> str:
    """Start log.md in OKF's date-grouped form (agents/okf.py)."""
    from . import okf

    sha_str = f" at commit {initial_sha[:7]}" if initial_sha else ""
    return okf.new_log(app_name, f"Knowledge base generated by NoX{sha_str}.")


def append_log_entry(current_log: str, action: str, summary: str, details: list) -> str:
    """Add an entry to log.md under today's date, newest first (OKF §9)."""
    from . import okf

    return okf.append_log(current_log, f"{summary} ({action}).", details)


# ---------------------------------------------------------------------------
# Synthesis / link-repair pass
# ---------------------------------------------------------------------------

async def run_synthesis_pass(files: dict, plan: list, candidate_contracts: list = None) -> dict:
    """Post-compilation pass to verify and repair wikilinks across all compiled pages.

    Deterministically resolves wikilinks against the plan manifest, fixes leaf-only links,
    preserves valid cross-KB [[ap:...]] links, and automatically weaves matched cross-KB contracts.
    """
    valid_targets = {"index"}
    leaf_to_full = {}

    for page in plan:
        clean_path = page["path"].replace(".md", "")
        valid_targets.add(clean_path)
        leaf_name = clean_path.split("/")[-1]
        leaf_to_full[leaf_name] = clean_path

    for path in list(files.keys()):
        clean_path = path.replace(".md", "")
        valid_targets.add(clean_path)
        leaf_name = clean_path.split("/")[-1]
        leaf_to_full[leaf_name] = clean_path

    # Deterministic cross-KB link weaving for matched candidate contracts
    if candidate_contracts:
        for c in candidate_contracts:
            app = getattr(c, "app_name", "") if not isinstance(c, dict) else c.get("app_name", "")
            repo = getattr(c, "repo_name", "") if not isinstance(c, dict) else c.get("repo_name", "")
            org_slug = getattr(c, "org_slug", "") if not isinstance(c, dict) else c.get("org_slug", "")
            page = getattr(c, "page_path", "") if not isinstance(c, dict) else c.get("page_path", "")
            anchor = getattr(c, "anchor_slug", "") if not isinstance(c, dict) else c.get("anchor_slug", "")
            ident = getattr(c, "identifier", "") if not isinstance(c, dict) else c.get("identifier", "")
            if not ident or not app:
                continue

            if not repo:
                clean_app = re.sub(r'[\s_-]+', '-', re.sub(r'[^\w\s-]', '', app.lower().strip())).strip('-')
                if org_slug:
                    clean_org = re.sub(r'[\s_-]+', '-', re.sub(r'[^\w\s-]', '', org_slug.lower().strip())).strip('-')
                    repo = f"kb-{clean_org}-{clean_app}"
                else:
                    repo = f"kb-{clean_app}"

            clean_path = page.replace(".md", "")
            link_target = f"ap:{repo}/{clean_path}"
            if anchor:
                link_target += f"#{anchor}"
            wikilink_replacement = f"[[{link_target}|{app} ({ident})]]"

            escaped_ident = re.escape(ident)
            # Match backticked `ident` that is not already part of a [[wikilink]]
            backtick_pattern = re.compile(rf"(?<!\[\[)`{escaped_ident}`(?!\]\])")
            for path in list(files.keys()):
                if path in ("AGENTS.md", ".nox/brief.md"):
                    continue
                files[path] = backtick_pattern.sub(wikilink_replacement, files[path])

    # Regex repair pass for all files (local, remote, and hybrid)
    pattern = re.compile(r'\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]')

    for path, content in list(files.items()):
        # Protect AGENTS.md and brief.md
        if path in ("AGENTS.md", ".nox/brief.md"):
            continue

        def _repair_link(match):
            target = match.group(1).strip().replace(".md", "")
            anchor = match.group(2)
            label = match.group(3)

            # Preserve cross-KB links: [[ap:repo/path#anchor|Label]] or [[kb:repo/path#anchor|Label]]
            if target.startswith("ap:") or target.startswith("kb:"):
                target_str = f"{target}#{anchor}" if anchor else target
                return f"[[{target_str}|{label}]]" if label else f"[[{target_str}]]"
            
            # Exact match
            if target in valid_targets:
                target_str = f"{target}#{anchor}" if anchor else target
                return f"[[{target_str}|{label}]]" if label else f"[[{target_str}]]"
            
            # Leaf name match (e.g. [[surveillance-monitor]] -> [[entities/surveillance-monitor]])
            leaf = target.split("/")[-1]
            if leaf in leaf_to_full:
                resolved = leaf_to_full[leaf]
                resolved_str = f"{resolved}#{anchor}" if anchor else resolved
                display = label if label else leaf
                return f"[[{resolved_str}|{display}]]" if display != resolved_str else f"[[{resolved_str}]]"

            # Unknown page reference -> convert to inline code span to prevent 404 broken links
            return f"`{label or target}`"

        files[path] = pattern.sub(_repair_link, content)

    return files




# ---------------------------------------------------------------------------
# Patch compilation helper
# ---------------------------------------------------------------------------

async def run_patch_compiler(context, patch_files: list = None) -> dict:
    """Incremental compiler pass for patch updates based on git diffs."""
    mode = settings.AI_MODE
    logger.info(f"🌟 [Patch Compilation] Compiling patch updates for {context.app_name}...")

    # Load existing documentation structure and checkpoints
    cached_compiled = load_checkpoint_json(context.kb_id, "compiled_files.json") or {}
    summary = load_kb_content(context.kb_id, "summary.md") or ""
    plan_dict = load_checkpoint_json(context.kb_id, "plan.json") or {}
    plan = plan_dict.get("pages", [])

    manifest = _build_manifest(plan) if plan else "[[index]] - Architecture Overview"

    existing_paths = list(cached_compiled.keys()) if cached_compiled else [
        "index.md", "summaries/api-spec.md", "summaries/core-logic.md", "concepts/business-logic.md"
    ]

    patch_prompt = (
        f"You are an expert technical documentation compiler updating an existing knowledge base (an Open Knowledge Format bundle) for '{context.app_name}'.\n\n"
        f"A recent commit changed the source codebase with the following Git Diff:\n"
        f"```diff\n{context.ingested_content[:40000]}\n```\n\n"
        f"The existing documentation contains these pages:\n"
        f"{json.dumps(existing_paths, indent=2)}\n\n"
        f"Existing Architecture Summary:\n{summary[:3000]}\n\n"
        f"KNOWLEDGE BASE MANIFEST (use [[wikilinks]] for cross-references):\n{manifest}\n\n"
        f"INSTRUCTIONS:\n"
        f"1. Determine which documentation files need to be updated or created to accurately reflect these code changes.\n"
        f"2. For each affected file (e.g. 'summaries/api-spec.md', 'summaries/db-schema.md', 'index.md'), generate the complete, updated markdown content.\n"
        f"3. Use Obsidian-compatible [[wikilinks]].\n"
        f"4. Return only the files that must change, each with its path and complete updated Markdown.\n"
    )

    force_mode = "remote" if mode in ("remote", "hybrid") else "local"

    try:
        patch = await structured.ask(PagePatch, patch_prompt, name="patch_compiler", instruction=SYSTEM_COMPILER,
                                     local=force_mode == "local")
        updated_files = {f.path: f.markdown for f in patch.files if f.path and f.markdown}
        if not updated_files:
            raise ValueError("Patch compiler returned no files")

        import difflib
        genuine_updates = {}
        for path, new_content in updated_files.items():
            old_content = cached_compiled.get(path, "")
            if not old_content:
                genuine_updates[path] = new_content
                continue
                
            matcher = difflib.SequenceMatcher(None, old_content, new_content)
            ratio = matcher.quick_ratio()
            
            if ratio < 0.98:  # If it's less than 98% similar, it's a genuine change
                genuine_updates[path] = new_content
            else:
                logger.info(f"Skipping patch for {path} as similarity is {ratio*100:.2f}% (too similar)")
                
        if not genuine_updates:
            logger.info("Patch compiler produced no significant changes after similarity filtering.")
        
        updated_files = genuine_updates

    except Exception as e:
        logger.error(f"Patch compilation failed or returned invalid JSON: {e}, using minimal patch fallback")
        updated_files = {
            "summaries/recent-updates.md": (
                f"# Recent Updates\n\n"
                f"Automated sync from commit.\n\n"
                f"## Changes\n```\n{context.ingested_content[:1500]}\n```\n"
            )
        }

    # Update log.md
    log_content = (cached_compiled.get("log.md") if cached_compiled else None) or _generate_log_timeline(context.app_name)
    updated_log = append_log_entry(
        log_content,
        action="patch",
        summary=f"Automated patch update on commit {getattr(context, 'commit_sha', '')[:7]}",
        details=[f"Updated {p}" for p in updated_files.keys()]
    )
    updated_files["log.md"] = updated_log

    # Update architecture digest
    if cached_compiled is not None:
        cached_compiled.update(updated_files)
        org_slug = getattr(context, "org_slug", "org")
        updated_digest = generate_architecture_digest(context.app_name, org_slug, cached_compiled)
        updated_files[".nox/brief.md"] = updated_digest
        cached_compiled[".nox/brief.md"] = updated_digest

    for path, content in updated_files.items():
        upload_content(context.kb_id, f"pages/{path}", content)
        if cached_compiled is not None:
            cached_compiled[path] = content

    if cached_compiled:
        save_checkpoint_json(context.kb_id, "compiled_files.json", cached_compiled)

    return updated_files


# ---------------------------------------------------------------------------
# Main compiler entry point
# ---------------------------------------------------------------------------

async def run_compiler(context, patch_files: list = None, log_callback = None) -> dict:
    """Multi-step KB compilation pipeline.

    Steps:
      1. Generate high-level summary.
      2. Generate documentation plan (page list).
      3. Build page manifest (zero cost — derived from plan).
      4. Compile each page with manifest injected into the prompt.
      5. Run synthesis pass to verify/repair wikilinks.

    Mode behaviour:
      local  — summary from architecture index only; plan capped at LOCAL_MAX_PAGES;
               pages compiled sequentially with tight token budget; regex link repair.
      remote — summary + plan generated in a single combined call; concurrent
               page compilation with Semaphore(REMOTE_SEMAPHORE_LIMIT); Gemini
               synthesis pass.
      hybrid — summary from Gemini (has full context); plan from Gemini; pages
               routed by category (local=summaries/entities, remote=concepts/decisions);
               Gemini synthesis pass.
    """
    mode = get_env_var("AI_MODE", getattr(settings, "AI_MODE", "remote"))

    # If in patch compilation mode, execute incremental patch compiler
    if patch_files is not None or getattr(context, 'decision', '') == 'significant':
        return await run_patch_compiler(context, patch_files)

    # ── Checkpoint Check: Fully compiled files already exist? ─────────────
    cached_compiled = load_checkpoint_json(context.kb_id, "compiled_files.json")
    if cached_compiled and "index.md" in cached_compiled and len(cached_compiled) > 1:
        logger.info(f"⚡ [RESUME] Found existing compiled files checkpoint ({len(cached_compiled)} files) for KB {context.kb_id}. Skipping compilation.")
        return cached_compiled

    # ── Step 1: High-level summary ─────────────────────────────────────────
    summary = load_kb_content(context.kb_id, "summary.md")
    if summary:
        logger.info(f"⚡ [RESUME] Loaded cached architectural summary for KB {context.kb_id}")
    else:
        logger.info(f"[compile/step1] Generating summary for {context.app_name} (mode={mode})")

        if mode == "local":
            # Use the architecture index (already summarised) — stays within context
            summary_prompt = (
                f"Write a high-level architectural summary of this application "
                f"based on the architecture index below.\n\n"
                f"Architecture Index:\n{context.ingested_content}"
            )
            summary_force_mode = "local"
        else:
            # remote / hybrid: Gemini sees the full raw code for maximum fidelity
            summary_prompt = (
                f"Write a comprehensive high-level architectural summary of this "
                f"application based on the ingested code.\n\nCode:\n{context.ingested_content}"
            )
            summary_force_mode = "remote"

        summary = await llm_client.generate(
            prompt=summary_prompt,
            system=SYSTEM_COMPILER,
            force_mode=summary_force_mode,
        )
        upload_content(context.kb_id, "summary.md", summary)

    # ── Step 2: Documentation plan ─────────────────────────────────────────
    max_pages = settings.LOCAL_MAX_PAGES if mode == "local" else settings.REMOTE_MAX_PAGES
    plan_dict = load_checkpoint_json(context.kb_id, "plan.json")
    if plan_dict and "pages" in plan_dict and len(plan_dict["pages"]) > 0:
        plan = plan_dict["pages"][:max_pages]
        logger.info(f"⚡ [RESUME] Loaded cached documentation plan ({len(plan)} pages) for KB {context.kb_id}")
    else:
        logger.info("[compile/step2] Generating documentation plan")

        plan_schema = (
            '{\n'
            '  "pages": [\n'
            '    {"path": "summaries/api-spec.md", "topic": "REST API endpoints"},\n'
            '    {"path": "concepts/data-pipeline.md", "topic": "Data flow"}\n'
            '  ]\n'
            '}'
        )
        plan_prompt = (
            f"Based on this summary, list the specific documentation pages to create "
            f"in the Knowledge Base. Use directories: 'summaries/', 'concepts/', "
            f"'entities/', 'decisions/'. Limit to {max_pages} pages.\n\n"
            f"Output JSON ONLY:\n{plan_schema}\n\n"
            f"Summary:\n{summary}"
        )

        plan_raw = await llm_client.generate(
            prompt=plan_prompt,
            system=SYSTEM_COMPILER,
            force_json=True,
            force_mode="remote" if mode in ("remote", "hybrid") else "local",
        )

        # Strip markdown fences if model wrapped the JSON
        plan_text = plan_raw.strip()
        if plan_text.startswith("```"):
            plan_text = re.sub(r"^```(?:json)?", "", plan_text)
            plan_text = re.sub(r"```$", "", plan_text.strip()).strip()

        try:
            plan = json.loads(plan_text).get("pages", [])
            if not plan:
                plan = [
                    {"path": "summaries/core-logic.md", "topic": "Core logic"},
                    {"path": "summaries/api-spec.md", "topic": "API routes"},
                ]
        except Exception as e:
            logger.error(f"Failed to parse plan JSON: {e} — Raw: {plan_raw}")
            plan = [{"path": "summaries/core-logic.md", "topic": "Core logic"}]

        # Apply page cap
        plan = plan[:max_pages]
        save_checkpoint_json(context.kb_id, "plan.json", {"pages": plan})

    # ── Step 3: Build page manifest (zero LLM cost) ────────────────────────
    page_manifest = _build_manifest(plan)
    logger.info(f"[compile/step3] Manifest built: {len(plan)} pages")

    # ── Step 4: Compile individual pages ───────────────────────────────────
    logger.info(f"[compile/step4] Compiling {len(plan)} pages")

    # Budget for raw code context per page
    local_code_budget = settings.LOCAL_PAGE_TOKEN_BUDGET  # chars (~5k tokens)
    remote_code_budget = 60000                             # chars, Gemini can handle it

    files: dict = {"index.md": summary}

    async def compile_page(page_def: dict) -> tuple:
        path = page_def.get("path", "untitled.md")
        topic = page_def.get("topic", "General documentation")
        
        # Check if individual page was already compiled and cached
        cached_page = load_kb_content(context.kb_id, f"pages/{path}")
        if cached_page:
            logger.info(f"  ⚡ [RESUME] Loaded cached page: {path}")
            return path, cached_page

        page_mode = _route_page(path)
        code_budget = local_code_budget if page_mode == "local" else remote_code_budget
        relevant_code = _filter_raw_code(context.raw_content, topic, max_chars=code_budget)

        # num_ctx override for local: keep page prompt inside 8k window
        num_ctx = 8192 if page_mode == "local" else None

        schema_instruction = ""
        if path.startswith("entities/"):
            schema_instruction = "\nSCHEMA REQUIREMENT FOR ENTITY PAGES: You MUST include '## Responsibilities' and '## Dependencies' section headers.\n"
        elif path.startswith("decisions/"):
            schema_instruction = "\nSCHEMA REQUIREMENT FOR DECISION RECORDS (ADRs): You MUST include '## Status', '## Context', and '## Decision' section headers.\n"

        cross_kb_manifest = _build_cross_kb_manifest(getattr(context, "candidate_contracts", None) or [])

        page_prompt = (
            f"Write the markdown documentation for '{path}'.\n"
            f"Topic to cover: {topic}\n{schema_instruction}\n"
            f"KNOWLEDGE BASE PAGE MANIFEST — use [[wikilinks]] to cross-reference "
            f"these pages where relevant:\n{page_manifest}"
            f"{cross_kb_manifest}\n\n"
            f"Use this architectural summary for context:\n{summary}\n\n"
            f"Use this relevant source code for exact details:\n{relevant_code}\n\n"
            f"Only output the raw markdown content. Use [[wikilinks]] from the manifest."
        )

        logger.info(f"  Compiling {path} via {page_mode}...")
        content = await llm_client.generate(
            prompt=page_prompt,
            system=SYSTEM_COMPILER,
            force_mode=page_mode,
            num_ctx_override=num_ctx,
        )
        # Automatically embed a code anchor on code-grounded pages if source file identifiable
        if (path.startswith("summaries/") or path.startswith("entities/")) and "<!-- anchor:" not in content:
            source_file_match = re.search(r'--- FILE: (.*?) ---', relevant_code)
            if source_file_match:
                source_file = source_file_match.group(1).strip()
                anchor_tag = generate_anchor_tag(source_file, 1, 100, getattr(context, 'commit_sha', 'HEAD'))
                content = f"{anchor_tag}\n\n{content}"

        # Checkpoint individual page immediately upon generation
        upload_content(context.kb_id, f"pages/{path}", content)
        if log_callback:
            try:
                await log_callback("page_compiled", {
                    "path": path,
                    "topic": topic,
                    "message": f"Compiled documentation section: {topic}"
                })
            except Exception as e:
                logger.warning(f"Failed to emit page_compiled event: {e}")
        return path, content

    if mode == "local":
        # Sequential — protect VRAM
        for page_def in plan:
            path, content = await compile_page(page_def)
            files[path] = content
    elif mode == "remote":
        is_safe = get_env_var("GEMINI_RATE_LIMIT_SAFE_MODE", "true").lower() in ("true", "1", "yes")
        try:
            delay_sec = float(get_env_var("GEMINI_REQUEST_DELAY_SECONDS", "1.5"))
        except ValueError:
            delay_sec = 1.5

        if is_safe:
            logger.info(f"[compile/step4] Safe Mode active: compiling {len(plan)} pages sequentially with pacing delays ({delay_sec}s).")
            for page_def in plan:
                path, content = await compile_page(page_def)
                files[path] = content
                if delay_sec > 0:
                    await asyncio.sleep(delay_sec)
        else:
            # Concurrent with semaphore cap
            try:
                max_conc = int(get_env_var("GEMINI_MAX_CONCURRENCY", "2"))
            except ValueError:
                max_conc = 2
            limit = max_conc or getattr(settings, "REMOTE_SEMAPHORE_LIMIT", 2)
            sem = asyncio.Semaphore(limit)
            async def _guarded(page_def):
                async with sem:
                    res = await compile_page(page_def)
                    if delay_sec > 0:
                        await asyncio.sleep(delay_sec)
                    return res
            results = await asyncio.gather(*[_guarded(p) for p in plan])
            for path, content in results:
                files[path] = content
    else:
        # hybrid: local pages run sequentially (VRAM), remote pages run concurrently/paced
        local_pages = [p for p in plan if _route_page(p["path"]) == "local"]
        remote_pages = [p for p in plan if _route_page(p["path"]) == "remote"]
        is_safe = get_env_var("GEMINI_RATE_LIMIT_SAFE_MODE", "true").lower() in ("true", "1", "yes")
        try:
            delay_sec = float(get_env_var("GEMINI_REQUEST_DELAY_SECONDS", "1.5"))
        except ValueError:
            delay_sec = 1.5

        # Local pages — sequential
        for page_def in local_pages:
            path, content = await compile_page(page_def)
            files[path] = content

        # Remote pages — safe mode or bounded semaphore
        if remote_pages:
            if is_safe:
                logger.info(f"[compile/step4/hybrid] Compiling {len(remote_pages)} remote pages in safe mode with pacing delays.")
                for page_def in remote_pages:
                    path, content = await compile_page(page_def)
                    files[path] = content
                    if delay_sec > 0:
                        await asyncio.sleep(delay_sec)
            else:
                try:
                    max_conc = int(get_env_var("GEMINI_MAX_CONCURRENCY", "2"))
                except ValueError:
                    max_conc = 2
                sem = asyncio.Semaphore(max_conc)
                async def _guarded_hybrid(page_def):
                    async with sem:
                        res = await compile_page(page_def)
                        if delay_sec > 0:
                            await asyncio.sleep(delay_sec)
                        return res
                results = await asyncio.gather(*[_guarded_hybrid(p) for p in remote_pages])
                for path, content in results:
                    files[path] = content

    # ── Step 5: Synthesis / link-repair pass ───────────────────────────────
    logger.info("[compile/step5] Running synthesis pass")
    files = await run_synthesis_pass(files, plan, candidate_contracts=getattr(context, "candidate_contracts", None))

    # ── Step 6: Generate AGENTS.md Contract & log.md Timeline ──────────────
    org_slug = getattr(context, "org_slug", "org")
    app_name = context.app_name
    files["AGENTS.md"] = _generate_agents_contract(app_name, org_slug)
    files["log.md"] = _generate_log_timeline(app_name, getattr(context, "commit_sha", ""))

    # ── Step 7: Generate Compact Architecture Digest (<4,000 chars) ───────
    files[".nox/brief.md"] = generate_architecture_digest(app_name, org_slug, files)

    # ── Step 8: Deterministic Pre-PR Quality Gate (Linter) ─────────────────
    lint_report = run_linter(files, plan)
    logger.info(
        f"Deterministic Quality Gate: valid={lint_report.is_valid}, "
        f"errors={len(lint_report.errors)}, warnings={len(lint_report.warnings)}"
    )
    
    # Save master compiled files checkpoint
    save_checkpoint_json(context.kb_id, "compiled_files.json", files)

    return files


