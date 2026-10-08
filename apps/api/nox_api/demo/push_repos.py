"""Create the Tidewell demo repositories on GitHub and push the reference code.

For every app in demo/tidewell/codebases/: create <org>/<app> if missing, and commit the local copy to
`main` when it differs. Then push each prepared branch from demo/tidewell/branches/<branch>/<app>/,
overlaid on main, without merging it (Flow B and PR guard beats). With --open-prs, also open the
PR-guard branch as a pull request.

The org defaults to GITHUB_DEFAULT_ORG; the NoX GitHub App must be installed on it.

Run from apps/api:  uv run python -m nox_api.demo.push_repos [--org tidewell-demo] [--app billing-service] [--dry-run]
"""

import argparse
import logging
from pathlib import Path

from github import GithubException, InputGitTreeElement

from ..core.config import settings
from ..services.gitops import _get_target_owner, get_bot_committer, get_github_client
from . import estate

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("demo-push")

CODEBASES = estate.ESTATE_DIR / "codebases"
BRANCHES = estate.ESTATE_DIR / "branches"
PR_BRANCHES = {"refactor/drop-excess-field": "Drop excess_amount from the claim reported event"}


def local_files(root: Path) -> dict[str, str]:
    return {str(f.relative_to(root)): f.read_text() for f in sorted(root.rglob("*")) if f.is_file() and f.name != ".DS_Store"}


def commit(repo, branch: str, files: dict[str, str], message: str, base_sha: str) -> str:
    author = get_bot_committer()
    tree = repo.create_git_tree([InputGitTreeElement(p, "100644", "blob", c) for p, c in files.items()], repo.get_git_tree(base_sha))
    c = repo.create_git_commit(message=message, tree=tree, parents=[repo.get_git_commit(base_sha)], author=author, committer=author)
    try:
        repo.get_git_ref(f"heads/{branch}").edit(c.sha, force=True)
    except GithubException:
        repo.create_git_ref(ref=f"refs/heads/{branch}", sha=c.sha)
    return c.sha


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--org", default=settings.GITHUB_DEFAULT_ORG)
    parser.add_argument("--app", action="append", help="limit to these apps")
    parser.add_argument("--open-prs", action="store_true", help="open the PR-guard branch as a pull request")
    parser.add_argument("--dry-run", action="store_true", help="show what would change; push nothing")
    args = parser.parse_args()

    m = estate.load()
    g = get_github_client()
    owner = _get_target_owner(g, args.org)
    for app in m["apps"]:
        if args.app and app not in args.app:
            continue
        files = local_files(CODEBASES / app)
        if args.dry_run:
            logger.info(f"{args.org}/{app}: {len(files)} files")
            continue
        try:
            repo = g.get_repo(f"{args.org}/{app}")
        except GithubException:
            repo = owner.create_repo(name=app, description=m["apps"][app]["summary"], private=False, auto_init=True)
            logger.info(f"➕ {repo.html_url}")
        main_sha = repo.get_branch(repo.default_branch).commit.sha
        changed = {}
        for path, content in files.items():
            try:
                remote = repo.get_contents(path, ref=repo.default_branch).decoded_content.decode()
            except GithubException:
                remote = None
            if remote != content:
                changed[path] = content
        if changed:
            main_sha = commit(repo, repo.default_branch, changed, f"Add {app} ({len(changed)} files)", main_sha)
            logger.info(f"⬆️  {repo.full_name}: {len(changed)} files on {repo.default_branch}")
        else:
            logger.info(f"ℹ️  {repo.full_name}: up to date")

        for branch, spec in m.get("branches", {}).items():
            if spec["app"] != app:
                continue
            overlay = local_files(BRANCHES / branch / app)
            commit(repo, branch, overlay, f"{branch}: {spec['beat']}", main_sha)
            logger.info(f"🌿 {repo.full_name}@{branch}")
            if args.open_prs and branch in PR_BRANCHES and not list(repo.get_pulls(state="open", head=f"{args.org}:{branch}")):
                pr = repo.create_pull(title=PR_BRANCHES[branch], body="Simplifies the event payload.", head=branch, base=repo.default_branch)
                logger.info(f"🔀 {pr.html_url}")


if __name__ == "__main__":
    main()
