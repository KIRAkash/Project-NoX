import logging
import re
from pathlib import Path

from github import Auth, Github, GithubException, GithubIntegration, InputGitAuthor, InputGitTreeElement

from ..core.config import settings

logger = logging.getLogger(__name__)

def _load_private_key() -> str:
    """Load GitHub App private key from config (inline or file path)."""
    if getattr(settings, "GITHUB_APP_PRIVATE_KEY", None):
        key = settings.GITHUB_APP_PRIVATE_KEY
        return key.replace("\\n", "\n")
    
    key_path = getattr(settings, "GITHUB_APP_PRIVATE_KEY_PATH", None)
    if key_path:
        p = Path(key_path)
        if not p.is_absolute() and not p.is_file():
            # Fallback to resolving relative to the project root
            from ..core.config import _ROOT_DIR
            p = _ROOT_DIR / key_path
            
        if p.is_file():
            try:
                return p.read_text(encoding="utf-8")
            except Exception as e:
                logger.error(f"Failed to read GitHub App private key at {p}: {e}")
    return ""

def get_github_client(installation_id: int | None = None) -> Github:
    """Instantiate a PyGitHub client authenticated as the GitHub App Installation (or legacy PAT)."""
    app_id = getattr(settings, "GITHUB_APP_ID", None)
    private_key = _load_private_key()

    if app_id and private_key:
        try:
            app_auth = Auth.AppAuth(app_id=int(app_id), private_key=private_key)
            inst_id = installation_id or (
                int(settings.GITHUB_APP_INSTALLATION_ID)
                if getattr(settings, "GITHUB_APP_INSTALLATION_ID", None)
                else None
            )
            if inst_id:
                installation_auth = Auth.AppInstallationAuth(app_auth=app_auth, installation_id=inst_id)
                return Github(auth=installation_auth)
            return Github(auth=app_auth)
        except Exception as e:
            logger.error(f"Error configuring GitHub App client ({e}). Falling back to PAT/default.")

    token = getattr(settings, "GITHUB_APP_TOKEN", None)
    if token:
        auth = Auth.Token(token)
        return Github(auth=auth)
    return Github()

def get_github_app_installation_token(installation_id: int | None = None) -> str | None:
    """Retrieve an ephemeral GitHub App installation access token for raw HTTP or git operations."""
    app_id = getattr(settings, "GITHUB_APP_ID", None)
    private_key = _load_private_key()
    inst_id = installation_id or (
        int(settings.GITHUB_APP_INSTALLATION_ID)
        if getattr(settings, "GITHUB_APP_INSTALLATION_ID", None)
        else None
    )

    if app_id and private_key and inst_id:
        try:
            app_auth = Auth.AppAuth(app_id=int(app_id), private_key=private_key)
            gi = GithubIntegration(auth=app_auth)
            access = gi.get_access_token(inst_id)
            return access.token
        except Exception as e:
            logger.error(f"Failed to mint GitHub App installation token: {e}")

    # Fallback to configured token
    token = getattr(settings, "GITHUB_APP_TOKEN", None)
    return token if token else None

def get_bot_committer() -> InputGitAuthor:
    """Return Git Author matching GitHub App bot identity convention."""
    slug = getattr(settings, "GITHUB_APP_SLUG", None) or "nox-gitops"
    app_id = getattr(settings, "GITHUB_APP_ID", None)
    name = f"{slug}[bot]"
    email = f"{app_id}+{slug}[bot]@users.noreply.github.com" if app_id else f"{slug}@users.noreply.github.com"
    return InputGitAuthor(name=name, email=email)

def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_-]+', '-', text)
    return text.strip('-')

def _get_target_owner(g: Github, github_org: str = None):
    """Resolve target owner: organization if valid/accessible, otherwise target account or authenticated user."""
    target_org = github_org or settings.GITHUB_DEFAULT_ORG or None
    if target_org:
        try:
            return g.get_organization(target_org)
        except Exception as e:
            logger.warning(
                f"Could not access GitHub organization '{target_org}' as org ({e}). "
                f"Attempting user lookup..."
            )
            try:
                return g.get_user(target_org)
            except Exception:
                pass
    try:
        return g.get_user()
    except Exception:
        return None

def kb_repo_name(org_slug: str, app_name: str) -> str:
    """Canonical name of an app's knowledge-base repository: kb-<org>-<app>."""
    return f"kb-{_slugify(org_slug)}-{_slugify(app_name)}"


def provision_kb_repo(org_slug: str, app_name: str, github_org: str = None) -> str:
    target_org = github_org or settings.GITHUB_DEFAULT_ORG or None
    g = get_github_client()
    owner = _get_target_owner(g, target_org)
    
    repo_name = kb_repo_name(org_slug, app_name)
    
    if owner is not None:
        try:
            repo = owner.create_repo(name=repo_name, private=False, auto_init=True)
            logger.info(f"Provisioned new KB repository: {repo.html_url}")
            return repo.html_url
        except GithubException as e:
            logger.warning(f"Repository {repo_name} create failed or already exists ({e.status}: {e.data}). Attempting to fetch existing...")
            try:
                repo = owner.get_repo(repo_name)
                return repo.html_url
            except Exception as fetch_err:
                logger.error(f"Failed to fetch existing repo {repo_name} after create failed: {fetch_err}")

    # Direct lookup fallback via repo full name
    full_name = f"{target_org}/{repo_name}"
    try:
        repo = g.get_repo(full_name)
        return repo.html_url
    except GithubException as e:
        logger.error(f"Failed to find or create repository {full_name}. Are GitHub credentials missing or invalid on Cloud Run?")
        raise RuntimeError(f"GitHub Provisioning Failed: Cannot find or create repository '{full_name}'. Ensure GITHUB_APP_TOKEN or Private Key is configured correctly in the deployment.") from e


def commit_kb_to_branch(repo_full_name: str, branch_name: str, kb_files: dict[str, str]):
    from ..agents.linter import assert_no_secrets

    assert_no_secrets(kb_files)  # every KB write goes through here, so this guards all flows
    g = get_github_client()
    repo = g.get_repo(repo_full_name)
    
    try:
        repo.get_branch(branch_name)
    except GithubException:
        main_ref = repo.get_git_ref("heads/main")
        repo.create_git_ref(ref=f"refs/heads/{branch_name}", sha=main_ref.object.sha)
    
    branch_ref = repo.get_git_ref(f"heads/{branch_name}")
    branch_sha = branch_ref.object.sha
    base_tree = repo.get_git_tree(branch_sha)

    element_list = list()
    for filepath, content in kb_files.items():
        if not filepath: continue
        element = InputGitTreeElement(filepath.lstrip("/"), '100644', 'blob', content or "")
        element_list.append(element)

    if not element_list:
        return  # Nothing to commit

    tree = repo.create_git_tree(element_list, base_tree)
    parent = repo.get_git_commit(branch_sha)
    author = get_bot_committer()
    commit = repo.create_git_commit(
        message=f"Update KB for {branch_name}",
        tree=tree,
        parents=[parent],
        author=author,
        committer=author
    )
    branch_ref.edit(commit.sha)

def open_pull_request(repo_full_name: str, branch: str, title: str, body: str) -> str:
    g = get_github_client()
    repo = g.get_repo(repo_full_name)
    try:
        pr = repo.create_pull(title=title, body=body, head=branch, base="main")
        return pr.html_url
    except GithubException as e:
        logger.info(f"PR creation failed or already exists ({e}). Looking for existing open PR...")
        # Check if an open PR for this branch already exists
        pulls = repo.get_pulls(state="open", head=f"{repo.owner.login}:{branch}")
        for p in pulls:
            return p.html_url
        # Also check just by branch name
        for p in repo.get_pulls(state="open"):
            if p.head.ref == branch:
                return p.html_url
        raise

def register_push_webhook(repo_full_name: str, webhook_url: str) -> str:
    g = get_github_client()
    repo = g.get_repo(repo_full_name)
    
    # Check if webhook with matching URL already exists
    try:
        for hook in repo.get_hooks():
            if hook.config.get("url") == webhook_url:
                logger.info(f"Push webhook already exists on {repo_full_name}: {hook.id}")
                return str(hook.id)
    except Exception:
        pass

    config = {
        "url": webhook_url,
        "content_type": "json",
        "secret": settings.WEBHOOK_SECRET
    }
    hook = repo.create_hook("web", config, ["push"], active=True)
    return str(hook.id)

def register_pr_webhook(repo_full_name: str, webhook_url: str) -> str:
    g = get_github_client()
    repo = g.get_repo(repo_full_name)
    
    # Check if webhook with matching URL already exists
    try:
        for hook in repo.get_hooks():
            if hook.config.get("url") == webhook_url:
                logger.info(f"PR webhook already exists on {repo_full_name}: {hook.id}")
                return str(hook.id)
    except Exception:
        pass

    config = {
        "url": webhook_url,
        "content_type": "json",
        "secret": settings.WEBHOOK_SECRET
    }
    hook = repo.create_hook("web", config, ["pull_request"], active=True)
    return str(hook.id)

def get_commit_diff(repo_full_name: str, commit_sha: str) -> str:
    g = get_github_client()
    repo = g.get_repo(repo_full_name)
    commit = repo.get_commit(commit_sha)
    diff = []
    for file in commit.files:
        diff.append(f"File: {file.filename}\nPatch: {file.patch}")
    return "\n".join(diff)

def provision_org_kb_repo(org_slug: str, github_org: str) -> str:
    return provision_kb_repo("org", org_slug, github_org)
