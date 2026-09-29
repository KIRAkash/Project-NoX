import asyncio
import base64
import logging
from collections.abc import Callable
from typing import Any

import httpx

from ..core.config import settings
from .base import BaseConnector, IncrementalDelta, IngestionAuthError, IngestionError, IngestionRateLimitError

logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {
    # Core Programming Languages
    '.py', '.ts', '.tsx', '.js', '.jsx', '.go', '.java', '.kt', '.scala',
    '.cs', '.cpp', '.c', '.cc', '.cxx', '.h', '.hpp', '.hxx',
    '.rs', '.swift', '.rb', '.php', '.lua', '.dart', '.r', '.m',
    # Scripting & Config
    '.sh', '.bash', '.zsh', '.sql', '.graphql', '.proto',
    '.yaml', '.yml', '.json', '.toml', '.xml', '.env.example',
    # Shaders & Engine Scripts
    '.shader', '.cginc', '.hlsl', '.glsl',
    # Documentation & Web
    '.md', '.mdx', '.txt', '.rst', '.html', '.css', '.scss'
}
SKIP_DIRS = {
    'node_modules', '.git', 'build', 'dist', 'venv', '.venv', '__pycache__',
    'Temp', 'Library', 'Logs', 'obj', 'bin', '.vs', '.idea', '.vscode',
    'target', 'vendor', '.next', 'out', '.gradle', 'Pods'
}

# Files that add noise but no signal — skip before chunking
JUNK_FILENAMES = {
    'package-lock.json', 'yarn.lock', 'poetry.lock', 'Pipfile.lock',
    'composer.lock', 'Cargo.lock', 'pnpm-lock.yaml', 'bun.lockb',
}

MAX_FILE_SIZE = 50 * 1024  # 50 KB per file

_PRIORITY = {
    '.py': 1, '.ts': 1, '.tsx': 1, '.js': 1, '.jsx': 1,
    '.go': 1, '.java': 1, '.kt': 1, '.rs': 1, '.swift': 1,
    '.cs': 1, '.cpp': 1, '.c': 1,
    '.graphql': 2, '.proto': 2, '.sql': 2,
    '.yaml': 3, '.yml': 3, '.toml': 3, '.json': 3,
    '.md': 4, '.mdx': 4, '.txt': 4, '.rst': 4,
    '.html': 5, '.css': 5, '.scss': 5,
}

def _mode_max_files() -> int:
    """Return the file ingestion cap for the current AI mode."""
    if settings.AI_MODE == "remote":
        return getattr(settings, "REMOTE_MAX_PAGES", 25)
    return getattr(settings, "LOCAL_MAX_FILES", 150)

def _prioritise_files(paths: list) -> list:
    """Sort files by type priority, then alphabetically, and apply the mode cap."""
    def _score(p: str) -> int:
        for ext, pri in _PRIORITY.items():
            if p.endswith(ext):
                return pri
        return 6

    cap = _mode_max_files() if settings.AI_MODE != "remote" else 500
    sorted_paths = sorted(paths, key=lambda p: (_score(p), p))
    return sorted_paths[:cap]

class GitHubConnector(BaseConnector):
    async def ingest(
        self,
        url: str,
        token: str | None,
        config: dict[str, Any] | None = None,
        on_progress: Callable[[str, dict[str, Any]], Any] | None = None
    ) -> str:
        headers = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "NoX-Ingestor"
        }
        if token and not token.startswith("ghp_dummy"):
            headers["Authorization"] = f"token {token}"
        else:
            try:
                from ..services.gitops import get_github_app_installation_token
                app_token = get_github_app_installation_token()
                if app_token:
                    headers["Authorization"] = f"token {app_token}"
            except Exception:
                pass

        parts = url.rstrip("/").split("/")
        if len(parts) < 2:
            raise IngestionError(f"Invalid GitHub URL: {url}")
        owner, repo = parts[-2], parts[-1]

        # ── Step 1: Get default branch ────────────────────────────────────
        repo_api_url = f"https://api.github.com/repos/{owner}/{repo}"
        async with self.semaphore:
            r = await self.client.get(repo_api_url, headers=headers)

        if r.status_code == 404:
            raise IngestionError(f"GitHub repository not found: {owner}/{repo}")
        elif r.status_code in (401, 403):
            raise IngestionAuthError(f"GitHub authentication failed: {r.text}")
        elif r.status_code == 429:
            raise IngestionRateLimitError("GitHub rate limit exceeded")
        elif r.status_code != 200:
            raise IngestionError(f"GitHub API error: {r.status_code} {r.text}")

        default_branch = (config or {}).get("branch") or r.json().get("default_branch", "main")

        # ── Step 2: Get recursive Git Tree ────────────────────────────────
        tree_url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/{default_branch}?recursive=1"
        async with self.semaphore:
            r = await self.client.get(tree_url, headers=headers)

        if r.status_code != 200:
            raise IngestionError(f"Failed to fetch git tree for {owner}/{repo}: {r.text}")

        tree_data = r.json()
        raw_tree = tree_data.get("tree", [])

        # ── Step 3: Filter files ──────────────────────────────────────────
        candidate_paths = []
        for item in raw_tree:
            if item.get("type") != "blob":
                continue
            path = item.get("path", "")
            size = item.get("size", 0)

            # Skip large files
            if size > MAX_FILE_SIZE:
                continue

            # Skip junk files
            if path.split('/')[-1] in JUNK_FILENAMES:
                continue

            # Skip excluded directories
            path_segments = set(path.split("/"))
            if path_segments & SKIP_DIRS:
                continue

            # Keep only allowed extensions
            if any(path.endswith(ext) for ext in ALLOWED_EXTENSIONS):
                candidate_paths.append(path)

        # ── Step 4: Prioritise and cap ────────────────────────────────────
        files_to_process = _prioritise_files(candidate_paths)

        if on_progress:
            try:
                on_progress("source_files_found", {
                    "source": url,
                    "file_count": len(files_to_process),
                    "total_in_tree": len(raw_tree),
                })
            except Exception:
                pass

        logger.info(
            f"Fetching {len(files_to_process)}/{len(candidate_paths)} candidate files "
            f"from {owner}/{repo} (mode={settings.AI_MODE})..."
        )

        # ── Step 5: Fetch file contents concurrently ──────────────────────
        results = {}

        async def _fetch_file(path: str):
            content_url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={default_branch}"
            async with self.semaphore:
                try:
                    r = await self.client.get(content_url, headers=headers)
                    if r.status_code == 200:
                        file_data = r.json()
                        encoding = file_data.get("encoding", "")
                        raw_encoded = file_data.get("content", "")
                        if encoding == "base64" and raw_encoded:
                            raw = base64.b64decode(raw_encoded).decode("utf-8", errors="replace")
                            results[path] = raw
                        else:
                            results[path] = "[Binary or unreadable content]"
                    elif r.status_code in (401, 403):
                        results[path] = "[Auth/Access error]"
                    else:
                        results[path] = f"[Fetch error: {r.status_code}]"
                except Exception as e:
                    logger.debug(f"Skipped {path}: {e}")
                    results[path] = "[Fetch exception]"

        await asyncio.gather(*[_fetch_file(p) for p in files_to_process])

        # Log progress summary
        logger.info(
            f"Completed ingestion for {owner}/{repo}: "
            f"{len(results)} files, approx {sum(len(v) for v in results.values())} chars"
        )

        if on_progress:
            try:
                on_progress("source_files_fetched", {
                    "source": url,
                    "fetched": len(results),
                    "total": len(files_to_process),
                })
            except Exception:
                pass

        # ── Build ordered content string ──────────────────────────────────
        content = ""
        for path in files_to_process:
            if path in results:
                content += f"\n\n--- FILE: {path} ---\n{results[path]}"

        return content

    async def check_incremental_updates(
        self,
        url: str,
        token: str | None,
        last_state: dict[str, Any] | None = None,
        config: dict[str, Any] | None = None
    ) -> IncrementalDelta:
        headers = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "NoX-Ingestor"
        }
        if token and not token.startswith("ghp_dummy"):
            headers["Authorization"] = f"token {token}"

        parts = url.rstrip("/").split("/")
        if len(parts) < 2:
            raise IngestionError(f"Invalid GitHub URL: {url}")
        owner, repo = parts[-2], parts[-1]

        commits_url = f"https://api.github.com/repos/{owner}/{repo}/commits"
        async with self.semaphore:
            r = await self.client.get(commits_url, headers=headers, params={"per_page": 5})

        if r.status_code in (401, 403):
            raise IngestionAuthError(f"GitHub auth failed: {r.text}")
        elif r.status_code != 200:
            raise IngestionError(f"Error checking GitHub commits: {r.text}")

        commits = r.json()
        if not commits or not isinstance(commits, list):
            return IncrementalDelta(
                has_changes=False,
                summary=f"No commits found in repo {owner}/{repo}",
                new_state=last_state or {},
                source_type="github",
                source_url=url,
            )

        latest = commits[0]
        latest_sha = latest.get("sha", "")
        last_sha = (last_state or {}).get("last_commit_sha") or (last_state or {}).get("sha")

        if last_sha and latest_sha == last_sha:
            return IncrementalDelta(
                has_changes=False,
                summary=f"No new commits on {owner}/{repo} (HEAD: {latest_sha[:7]})",
                new_state=last_state or {},
                source_type="github",
                source_url=url,
            )

        # Fetch commit details / diff
        commit_detail_url = f"https://api.github.com/repos/{owner}/{repo}/commits/{latest_sha}"
        async with self.semaphore:
            cr = await self.client.get(commit_detail_url, headers=headers)

        commit_data = cr.json() if cr.status_code == 200 else {}
        commit_msg = commit_data.get("commit", {}).get("message", "").split("\n")[0]
        author = commit_data.get("commit", {}).get("author", {}).get("name", "Unknown")
        files = commit_data.get("files", [])

        diff_parts = []
        changed_filenames = []
        for f in files:
            fname = f.get("filename", "")
            changed_filenames.append(fname)
            patch = f.get("patch", "")
            if patch:
                diff_parts.append(f"--- File: {fname} ---\n{patch}")
            else:
                diff_parts.append(f"--- File: {fname} ({f.get('status', 'modified')}) ---")

        diff_text = "\n\n".join(diff_parts)

        return IncrementalDelta(
            has_changes=True,
            delta_content=diff_text,
            summary=f"Commit {latest_sha[:7]} by {author}: '{commit_msg}' ({len(changed_filenames)} files changed)",
            new_state={"last_commit_sha": latest_sha, "commit_message": commit_msg, "author": author},
            affected_items=changed_filenames,
            source_type="github",
            source_url=url,
            author=author,
        )

async def fetch_github_repo(
    repo_url: str,
    github_token: str,
    config: dict[str, Any] | None = None,
    on_progress: Callable[[str, dict], None] | None = None,
) -> str:
    async with httpx.AsyncClient(timeout=30.0) as client:
        connector = GitHubConnector(client, concurrency_limit=10)
        return await connector.ingest(repo_url, github_token, config=config, on_progress=on_progress)
