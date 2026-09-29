import os
from pathlib import Path

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict


def _find_env_file() -> str | None:
    """Search upwards from current working directory and config file directory for .env."""
    if os.getenv("ENV_FILE") and os.path.exists(os.getenv("ENV_FILE")):
        return os.path.abspath(os.getenv("ENV_FILE"))
    
    # Check cwd and all its parents
    curr = Path.cwd().resolve()
    for parent in [curr] + list(curr.parents):
        candidate = parent / ".env"
        if candidate.is_file():
            return str(candidate)
            
    # Check config.py location and all its parents
    config_dir = Path(__file__).resolve().parent
    for parent in [config_dir] + list(config_dir.parents):
        candidate = parent / ".env"
        if candidate.is_file():
            return str(candidate)
            
    return None

_ENV_FILE = _find_env_file()
_ROOT_DIR = Path(_ENV_FILE).parent if _ENV_FILE else Path(__file__).resolve().parent.parent.parent.parent
if _ENV_FILE:
    load_dotenv(_ENV_FILE, override=False)  # real environment variables win over .env
else:
    load_dotenv(override=False)

class Settings(BaseSettings):
    # ── AI Mode ───────────────────────────────────────────────────────────────
    # "local"  : All LLM calls go to local Gemma via Ollama.
    # "remote" : All LLM calls go to Gemini Flash.
    # "hybrid" : Smart per-task routing — cheap/small tasks use local Gemma,
    #            complex/large-context tasks use remote Gemini.
    AI_MODE: str = "remote"

    # ── Gemini (Remote) ───────────────────────────────────────────────────────
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-3.7-flash"
    GEMINI_BACKUP_MODEL: str | None = "gemini-3.5-flash"

    # ── NoX AI (ADK agents) ───────────────────────────────────────────────────
    # "enterprise": Gemini Enterprise Agent Platform (formerly Vertex AI), service-account auth. Default on Cloud Run.
    # "api_key"   : Gemini Developer API with GEMINI_API_KEY (local dev without GCP credentials).
    # "local"     : Gemma via Ollama (NoX Local). Empty = enterprise when a project is set, else api_key.
    NOX_AI_BACKEND: str = ""
    GOOGLE_CLOUD_PROJECT: str = ""                     # Falls back to GCP_PROJECT_ID
    GCP_PROJECT_ID: str = ""
    GOOGLE_CLOUD_LOCATION: str = "global"              # newest Gemini models are served from the global endpoint
    NOX_MODEL_FAST: str = ""                           # classification / small structured calls; empty = GEMINI_MODEL
    NOX_MODEL_DEEP: str = ""                           # architecture mapping / rollup; empty = GEMINI_MODEL
    NOX_EMBED_MODEL: str = "gemini-embedding-2"
    NOX_EMBED_DIM: int = 768
    NOX_EMBEDDINGS: bool = True                        # off = keyword ranking only
    NOX_LOCAL_MODEL: str = "ollama_chat/gemma4:12b"    # LiteLLM model id for NoX Local
    NOX_LOCAL_NUM_CTX: int = 16384                     # Ollama's default 4096 silently truncates page prompts
    NOX_LOCAL_THINK: bool = False                      # Gemma 4 thinking: better on hard repos, ~4× slower locally
    NOX_MAX_CONCURRENCY: int = 8                       # parallel model calls inside one pipeline run
    NOX_KB_BUILDER: str = "agents"                     # "agents" (cartographer + parallel writers + reviewer) or "classic"

    # ── Gemma / Ollama (Local) ────────────────────────────────────────────────
    GEMMA_OLLAMA_URL: str = "http://localhost:11434"
    GEMMA_MODEL: str = "gemma"

    # ── GitHub App ────────────────────────────────────────────────────────────
    GITHUB_APP_TOKEN: str = ""                         # PAT fallback
    GITHUB_APP_ID: str | None = None                # GitHub App numeric ID
    GITHUB_APP_INSTALLATION_ID: str | None = None   # Target Org/Repo Installation ID
    GITHUB_APP_PRIVATE_KEY: str | None = None       # Inline PEM key string
    GITHUB_APP_PRIVATE_KEY_PATH: str | None = None  # Path to .pem private key file
    GITHUB_APP_SLUG: str = "nox-gitops"                # Bot name slug
    GITHUB_DEFAULT_ORG: str = ""                       # Where kb-* repos are created

    # ── Atlassian (Jira + Confluence) ─────────────────────────────────────────
    ATLASSIAN_BASE_URL: str = ""                       # e.g. https://yourco.atlassian.net
    ATLASSIAN_EMAIL: str = ""                          # Owner of the API token
    JIRA_API_TOKEN: str | None = None
    CONFLUENCE_API_TOKEN: str | None = None
    JIRA_WEBHOOK_SECRET: str = ""
    JIRA_DEFAULT_PROJECT: str = "APEX"
    JIRA_ALLOWED_PROJECTS: str = "APEX"
    JIRA_STATUS_MAP: str = ""                          # JSON overrides, e.g. {"verifying": "QA"}

    # ── Notion / Slack ────────────────────────────────────────────────────────
    NOTION_API_TOKEN: str | None = None
    NOTION_PARENT_PAGE_ID: str | None = None
    SLACK_BOT_TOKEN: str | None = None
    SLACK_SIGNING_SECRET: str | None = None

    # ── Firebase ──────────────────────────────────────────────────────────────
    FIREBASE_PROJECT_ID: str = ""                      # Falls back to NEXT_PUBLIC_FIREBASE_PROJECT_ID
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: str = ""
    FIREBASE_SERVICE_ACCOUNT_PATH: str | None = None
    NOX_TICKET_STORE: str = "memory"                   # "firestore": ticket state (assignee, pipeline) in Cloud Firestore
    FIRESTORE_DATABASE: str = "(default)"

    # ── Infrastructure ────────────────────────────────────────────────────────
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/nox"
    STORAGE_BACKEND: str = "local"                     # "local" or "gcs"
    GCS_BUCKET_NAME: str = ""
    GOOGLE_APPLICATION_CREDENTIALS: str | None = None
    REDIS_URL: str = "redis://localhost:6379/0"
    WORKER_MODE: str = "auto"                          # "auto", "celery", or "in_process"
    SOURCE_MONITOR_MODE: str = "webhook"
    WEBHOOK_SECRET: str = ""                           # Required; see validate_required_settings()
    WEBHOOK_BASE_URL: str = "http://localhost:8000"    # Override with public URL in production

    # ── NoX ───────────────────────────────────────────────────────────────────
    NOX_WEB_ORIGIN: str = "http://localhost:3000"      # Comma-separated CORS allow-list
    NOX_COMMIT_SPECS: bool = True
    NOX_DEMO_ORG_SLUGS: str = ""                       # New users auto-join these orgs (e.g. "apex")
    NOX_DEV_AUTH: bool = False                         # Accept `Authorization: Dev <email>`; local dev only

    # ── Local Mode Tuning ─────────────────────────────────────────────────────
    LOCAL_MAX_FILES: int = 150
    LOCAL_CHUNK_SIZE: int = 6000
    LOCAL_MAX_PAGES: int = 6
    LOCAL_PAGE_TOKEN_BUDGET: int = 20000  # ~5k tokens at 4 chars/token

    # ── Remote Mode Tuning & Rate Limiting ────────────────────────────────────
    GEMINI_RATE_LIMIT_SAFE_MODE: bool = True
    GEMINI_MAX_CONCURRENCY: int = 2
    GEMINI_REQUEST_DELAY_SECONDS: float = 2.0
    REMOTE_SEMAPHORE_LIMIT: int = 2
    REMOTE_INLINE_THRESHOLD: int = 2500000
    REMOTE_MAX_PAGES: int = 25

    # ── Hybrid Mode Tuning ────────────────────────────────────────────────────
    HYBRID_LOCAL_CATEGORIES: str = "summaries,entities"
    HYBRID_REMOTE_CATEGORIES: str = "concepts,decisions"
    HYBRID_MAX_LOCAL_FILES: int = 150
    HYBRID_ENABLE_SYNTHESIS_PASS: bool = True

    model_config = SettingsConfigDict(
        env_file=_ENV_FILE if _ENV_FILE else None,
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()

_WEAK_SECRETS = {"", "supersecret", "changeme", "secret", "generate-a-random-secret-here"}


def validate_required_settings(s: Settings = settings) -> None:
    """Fail fast at startup on settings the API must not run without."""
    problems = []
    if s.WEBHOOK_SECRET.strip() in _WEAK_SECRETS or len(s.WEBHOOK_SECRET.strip()) < 16:
        problems.append("WEBHOOK_SECRET must be set to a random string of at least 16 characters")
    if s.NOX_DEV_AUTH and (os.getenv("K_SERVICE") or os.getenv("DEPLOYMENT_MODE") == "cloud"):
        problems.append("NOX_DEV_AUTH must be off in cloud deployments")
    if not cors_origins(s):
        problems.append("NOX_WEB_ORIGIN must list at least one origin")
    if problems:
        raise RuntimeError("Invalid configuration: " + "; ".join(problems))


def cors_origins(s: Settings = settings) -> list[str]:
    return [o.strip().rstrip("/") for o in s.NOX_WEB_ORIGIN.split(",") if o.strip()]


def get_env_var(key: str, default: str = "") -> str:
    """Read a setting directly from the live .env file on disk, falling back to os.getenv/settings.
    
    This ensures model changes or rate limit tweaks in .env take effect immediately
    without requiring a full process or worker restart.
    """
    env_file = _find_env_file()
    if env_file and os.path.exists(env_file):
        try:
            with open(env_file, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("#") or not line:
                        continue
                    if line.startswith(f"{key}="):
                        val = line.split("=", 1)[1].strip()
                        if not (val.startswith('"') and val.endswith('"')) and not (val.startswith("'") and val.endswith("'")):
                            val = val.split("#", 1)[0].strip()
                        else:
                            val = val[1:-1].strip()
                        if val:
                            return val
        except Exception:
            pass
    return os.environ.get(key) or (str(getattr(settings, key)) if hasattr(settings, key) else default)


