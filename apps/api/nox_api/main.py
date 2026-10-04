import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.routing import Route

from .connectors.base import IngestionAuthError, IngestionError, IngestionRateLimitError
from .core.config import cors_origins, settings, validate_required_settings
from .core.logging import RequestIdMiddleware, configure_logging
from .db.database import engine, init_db
from .interop import a2a, mcp_server
from .routers import cli, integrations, jira, kb, me, media, missions, orgs, sightings, sources, webhooks
from .services.sse import get_sse_manager

configure_logging()
logger = logging.getLogger("nox")


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_required_settings()
    await init_db()
    app.state.sse_manager = get_sse_manager()
    ticker = None
    if settings.NOX_SIGHTINGS_TICK == "local":  # development: look for due Sightings runs without beat or Cloud Scheduler
        from .missions.sightings import local_ticker

        ticker = asyncio.get_running_loop().create_task(local_ticker(), name="sightings-tick")
    # Agents calling NoX: the MCP session manager and ADK's A2A routes start with the API.
    async with mcp_server.lifespan(), a2a.lifespan():
        yield
    if ticker:
        ticker.cancel()


app = FastAPI(title="NoX API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)
app.add_middleware(RequestIdMiddleware)


# An upstream source (GitHub, Jira, …) rejecting NoX's credentials is a gateway problem,
# not the caller's auth failing — so 502, keeping 401/403 for NoX's own user auth.
@app.exception_handler(IngestionAuthError)
async def ingestion_auth_exception_handler(request, exc: IngestionAuthError):
    return JSONResponse(status_code=502, content={"detail": f"Source authentication failed: {exc}"})


@app.exception_handler(IngestionRateLimitError)
async def ingestion_rate_limit_exception_handler(request, exc: IngestionRateLimitError):
    return JSONResponse(status_code=429, content={"detail": f"Source rate limit: {exc}"})


@app.exception_handler(IngestionError)
async def ingestion_exception_handler(request, exc: IngestionError):
    return JSONResponse(status_code=400, content={"detail": f"Ingestion error: {exc}"})


app.include_router(orgs.router)
app.include_router(kb.router)
app.include_router(webhooks.router)
app.include_router(integrations.router)
app.include_router(me.router)
app.include_router(sources.router)
app.include_router(missions.asset_router)  # before the {key} routes
app.include_router(missions.router)
app.include_router(media.router)
app.include_router(media.mission_router)
app.include_router(jira.router)
app.include_router(cli.router)
app.include_router(sightings.router)
app.include_router(sightings.org_router)
app.include_router(sightings.internal_router)

# MCP at exactly /mcp and A2A under /a2a/ask; both refuse requests without a NoX token (interop/).
app.router.routes.append(Route("/mcp", mcp_server.gate, methods=["GET", "POST", "DELETE"]))
app.router.routes.append(Route(a2a.PATH, a2a.gate, methods=["GET", "POST"]))
app.router.routes.append(Route(a2a.CARD_PATH, a2a.gate, methods=["GET"]))


@app.get("/healthz", tags=["Health"])
async def healthz():
    """Liveness: the process is up."""
    return {"status": "ok"}


@app.get("/readyz", tags=["Health"])
async def readyz():
    """Readiness: database and Redis reachable."""
    checks: dict[str, str] = {}
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as e:
        checks["database"] = f"error: {type(e).__name__}"
    try:
        import redis.asyncio as aioredis

        r = aioredis.from_url(settings.REDIS_URL)
        await r.ping()
        await r.aclose()
        checks["redis"] = "ok"
    except Exception as e:
        checks["redis"] = f"error: {type(e).__name__}"
    ok = all(v == "ok" for v in checks.values())
    return JSONResponse(status_code=200 if ok else 503, content={"status": "ok" if ok else "degraded", **checks})
