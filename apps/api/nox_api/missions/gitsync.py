"""Mirror spec files into the primary application's knowledge-base repository.

Layout in the KB repo:
    missions/NOX-12-<slug>/01-business.md … 04-developer.md, assets/…
Every save lands on branch `nox/NOX-12`; approving a file also writes it to the default branch.
Other applications the mission touches get a short pointer file, `missions/NOX-12.md`.

Git is a mirror: the database is authoritative, so failures are logged and never block a save.
"""

import asyncio
import logging
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.time_utils import now_utc
from ..db.models import KnowledgeBase, Mission, MissionApp, SpecFile, SpecFileVersion, SpecStatus, User
from .templates import FILE_NAME

logger = logging.getLogger(__name__)


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:48] or "mission"


def mission_dir(mission: Mission) -> str:
    """The mission's folder, fixed by the first file synced so later title edits don't split it."""
    for f in getattr(mission, "files", None) or []:
        if f.git_path:
            return f.git_path.rsplit("/", 1)[0]
    return f"missions/{mission.key}-{slug(mission.title)}"


def branch(mission: Mission) -> str:
    return f"nox/{mission.key}"


def repo_full_name(kb: KnowledgeBase) -> str | None:
    if not kb or not kb.git_repo_url:
        return None
    parts = kb.git_repo_url.rstrip("/").removesuffix(".git").split("/")
    return f"{parts[-2]}/{parts[-1]}" if len(parts) >= 2 else None


def with_front_matter(mission: Mission, f: SpecFile, author: str | None) -> str:
    fm = [
        "---",
        f"mission: {mission.key}",
        f"title: {mission.title!r}",
        f"role: {f.role.value}",
        f"status: {f.status.value}",
        f"version: {f.version}",
        f"author: {author or 'unknown'}",
        f"ai_drafted: {str(f.status == SpecStatus.ai_drafted).lower()}",
    ]
    if f.approved_at:
        fm.append(f"approved_at: {f.approved_at.isoformat(timespec='seconds')}Z")
    fm.append("---")
    return "\n".join(fm) + "\n\n" + (f.markdown or "")


def _commit(repo_name: str, files: dict[str, str], message: str, target_branch: str | None, base_from_default: bool = True) -> str | None:
    """Commit `files` to `target_branch` (default branch when None), creating the branch if needed. Returns the commit sha."""
    from github import GithubException, InputGitTreeElement

    from ..agents.linter import assert_no_secrets
    from ..services.gitops import get_github_client

    assert_no_secrets(files)
    repo = get_github_client().get_repo(repo_name)
    default = repo.default_branch
    ref_name = target_branch or default
    try:
        ref = repo.get_git_ref(f"heads/{ref_name}")
    except GithubException:
        base = repo.get_git_ref(f"heads/{default}")
        ref = repo.create_git_ref(f"refs/heads/{ref_name}", base.object.sha)
    parent = repo.get_git_commit(ref.object.sha)
    changed = {}
    for path, content in files.items():
        try:
            if repo.get_contents(path, ref=ref_name).decoded_content.decode() == content:
                continue
        except GithubException:
            pass
        changed[path] = content
    if not changed:
        return parent.sha  # nothing new: no empty commits
    files = changed
    tree = repo.create_git_tree(
        [InputGitTreeElement(path, "100644", "blob", content) for path, content in files.items()], base_tree=parent.tree
    )
    commit = repo.create_git_commit(message, tree, [parent])
    ref.edit(commit.sha)
    return commit.sha


async def sync_file_to_git(db: AsyncSession, mission: Mission, f: SpecFile, message: str, approve: bool = False) -> str | None:
    if not settings.NOX_COMMIT_SPECS:
        return None
    kb = await db.get(KnowledgeBase, mission.primary_kb_id) if mission.primary_kb_id else None
    repo = repo_full_name(kb)
    if not repo:
        return None
    author = await db.get(User, f.author_id) if f.author_id else None
    path = f"{mission_dir(mission)}/{FILE_NAME[f.role]}"
    content = with_front_matter(mission, f, (author.name or author.email) if author else ("NoX" if f.status == SpecStatus.ai_drafted else None))
    try:
        sha = await asyncio.to_thread(_commit, repo, {path: content}, message, branch(mission))
        if approve:
            sha = await asyncio.to_thread(_commit, repo, {path: content}, message, None)
        f.git_path = path
        f.git_commit_sha = sha
        latest = (
            await db.execute(select(SpecFileVersion).where(SpecFileVersion.spec_file_id == f.id, SpecFileVersion.version == f.version))
        ).scalars().first()
        if latest:
            latest.git_commit_sha = sha
        await db.commit()
        await _ensure_pointers(db, mission, kb)
        return sha
    except Exception as e:
        logger.warning(f"git sync of {mission.key}/{f.role.value} to {repo} failed: {e}")
        return None


async def commit_asset(db: AsyncSession, mission: Mission, name: str, data: bytes) -> str | None:
    """Binary assets (images) go to the mission branch as base64 blobs."""
    kb = await db.get(KnowledgeBase, mission.primary_kb_id) if mission.primary_kb_id else None
    repo = repo_full_name(kb)
    if not repo or not settings.NOX_COMMIT_SPECS:
        return None

    def put() -> str:
        from github import GithubException

        from ..services.gitops import get_github_client

        r = get_github_client().get_repo(repo)
        br = branch(mission)
        try:
            r.get_git_ref(f"heads/{br}")
        except GithubException:
            r.create_git_ref(f"refs/heads/{br}", r.get_git_ref(f"heads/{r.default_branch}").object.sha)
        path = f"{mission_dir(mission)}/assets/{name}"
        return r.create_file(path, f"{mission.key}: add {name}", data, branch=br)["commit"].sha

    try:
        return await asyncio.to_thread(put)
    except Exception as e:
        logger.warning(f"asset commit for {mission.key} failed: {e}")
        return None


async def _ensure_pointers(db: AsyncSession, mission: Mission, primary: KnowledgeBase) -> None:
    """Other applications in the mission get `missions/NOX-12.md` pointing at the primary repo (written once)."""
    kb_ids = (await db.execute(select(MissionApp.kb_id).where(MissionApp.mission_id == mission.id))).scalars().all()
    others = [k for k in [await db.get(KnowledgeBase, i) for i in kb_ids] if k and k.id != primary.id and repo_full_name(k)]
    for other in others:
        body = (
            f"# {mission.key}: {mission.title}\n\n"
            f"This change also touches **{other.app_name}**. Its spec files live in "
            f"[{repo_full_name(primary)}/{mission_dir(mission)}]({primary.git_repo_url}/tree/{branch(mission)}/{mission_dir(mission)}).\n"
        )
        try:  # unchanged content is skipped by _commit, so this is safe to repeat
            await asyncio.to_thread(_commit, repo_full_name(other), {f"missions/{mission.key}.md": body},
                                    f"{mission.key}: pointer to the spec files", branch(mission))
        except Exception as e:
            logger.warning(f"pointer for {mission.key} in {other.app_name} failed: {e}")


def stamp() -> str:
    return now_utc().strftime("%Y-%m-%d %H:%M")


def schedule_sync(mission_id, role, message: str, approve: bool = False) -> None:
    """Run the git mirror in the background with its own session, so saves never wait on GitHub."""
    from ..jobs import spawn

    async def run():
        from sqlalchemy.orm import selectinload

        from ..db.database import AsyncSessionLocal

        async with AsyncSessionLocal() as db:
            mission = (await db.execute(select(Mission).options(selectinload(Mission.files)).where(Mission.id == mission_id))).scalars().first()
            if not mission:
                return
            f = next((x for x in mission.files if x.role == role), None)
            if f:
                sha = await sync_file_to_git(db, mission, f, message, approve)
                if sha:
                    from .events import record

                    await record(db, mission, "git.synced", {"role": role.value, "sha": sha[:10], "path": f.git_path, "approved": approve})

    spawn(f"git sync {mission_id}", run)
