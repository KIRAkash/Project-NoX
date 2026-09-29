from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from ..core.config import settings


def get_db_sync():
    """Context manager yielding an async session within the current event loop and disposing the engine on exit."""
    @asynccontextmanager
    async def _session_scope():
        engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool, echo=False)
        session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
        async with session_factory() as session:
            try:
                yield session
            finally:
                await session.close()
                await engine.dispose()
    return _session_scope()
