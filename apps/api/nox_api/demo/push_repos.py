"""Propose the renamed demo code to each Apex GitHub repo as a pull request.

For every app in demo/codebases/, commits the local copy to branch `nox/rename-demo` of
<GITHUB_DEFAULT_ORG>/<app> and opens a PR against the default branch. Nothing is pushed to the
default branch directly — review and merge the PRs, then (re)generate the knowledge bases.

Run from apps/api:  uv run python -m nox_api.demo.push_repos [--app order-matching-engine] [--dry-run]
"""

import argparse
import logging
from pathlib import Path

from ..core.config import settings
from ..services.gitops import commit_kb_to_branch, get_github_client, open_pull_request

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("demo-push")

CODEBASES = Path(__file__).resolve().parents[4] / "demo" / "codebases"
BRANCH = "nox/rename-demo"


def local_files(app_dir: Path) -> dict[str, str]:
    files = {}
    for f in sorted(app_dir.rglob("*")):
        if f.is_file():
            try:
                files[str(f.relative_to(app_dir))] = f.read_text()
            except UnicodeDecodeError:
                logger.warning(f"skipping binary file {f}")
    return files


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", action="append", help="limit to these apps")
    parser.add_argument("--dry-run", action="store_true", help="show which files differ; push nothing")
    args = parser.parse_args()

    g = get_github_client()
    for app_dir in sorted(p for p in CODEBASES.iterdir() if p.is_dir()):
        if args.app and app_dir.name not in args.app:
            continue
        repo_name = f"{settings.GITHUB_DEFAULT_ORG}/{app_dir.name}"
        repo = g.get_repo(repo_name)
        files = local_files(app_dir)
        changed = []
        for path, content in files.items():
            try:
                remote = repo.get_contents(path).decoded_content.decode()
            except Exception:
                remote = None
            if remote != content:
                changed.append(path)
        logger.info(f"{repo_name}: {len(changed)} of {len(files)} files differ")
        if not changed or args.dry_run:
            continue
        commit_kb_to_branch(repo_name, BRANCH, {p: files[p] for p in changed})
        url = open_pull_request(
            repo_name,
            BRANCH,
            "Rename demo code to the Apex brand",
            "Uses `apex` in package names, namespaces and docs, "
            "so knowledge bases generated from this repo carry only the Apex brand.\n\n"
            f"Changed files: {len(changed)}.",
        )
        logger.info(f"🔀 {repo_name}: {url}")


if __name__ == "__main__":
    main()
