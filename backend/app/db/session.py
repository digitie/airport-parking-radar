from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

from sqlalchemy import event, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.models import Base


def create_engine_and_session_factory(database_url: str) -> tuple[AsyncEngine, async_sessionmaker[AsyncSession]]:
    if database_url.startswith("sqlite"):
        sqlite_url = make_url(database_url)
        database_path = sqlite_url.database
        if database_path and database_path != ":memory:":
            Path(database_path).parent.mkdir(parents=True, exist_ok=True)

    engine = create_async_engine(database_url, future=True)

    if database_url.startswith("sqlite"):
        @event.listens_for(engine.sync_engine, "connect")
        def set_sqlite_pragma(dbapi_connection, _connection_record) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA busy_timeout=5000")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.close()

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    return engine, session_factory


async def init_database(engine: AsyncEngine) -> None:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        await connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_parking_snapshots_airport_observed "
                "ON parking_snapshots (airport_id, observed_at)"
            )
        )
        await connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_parking_snapshots_lot_observed "
                "ON parking_snapshots (parking_lot_id, observed_at)"
            )
        )
        await connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_parking_snapshots_airport_lot_observed "
                "ON parking_snapshots (airport_id, parking_lot_id, observed_at)"
            )
        )
        await connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_parking_snapshots_airport_lot_observed_desc "
                "ON parking_snapshots (airport_id, parking_lot_id, observed_at DESC, id DESC)"
            )
        )
        await connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_parking_snapshots_collected_at "
                "ON parking_snapshots (collected_at)"
            )
        )
        await connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_parking_snapshots_collection_run_id "
                "ON parking_snapshots (collection_run_id)"
            )
        )
        await connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_raw_api_responses_collection_run_id "
                "ON raw_api_responses (collection_run_id)"
            )
        )
        await connection.execute(text("PRAGMA optimize"))


async def session_scope(
    session_factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncSession]:
    async with session_factory() as session:
        yield session
