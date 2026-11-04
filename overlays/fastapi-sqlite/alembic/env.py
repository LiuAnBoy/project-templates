"""Alembic's environment: migrations run on the async engine of the store.

``make db-migrate`` hands in its own connection (``config.attributes["connection"]``);
``make db-generate`` finds none and opens the store's migration engine itself. Both
read the connection from ``DATABASE_URL`` through ``db.database``, which is the only
module that names the store.
"""

import asyncio

from alembic import context
from sqlalchemy import Connection

from db import models  # noqa: F401  # registers every model on Base.metadata
from db.base import Base
from db.database import DatabaseSettings, create_migration_engine

config = context.config
target_metadata = Base.metadata


def run_migrations(connection: Connection) -> None:
    """Run the migrations on a connection.

    Args:
        connection: A synchronous view of the async connection.
    """
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # SQLite cannot alter most columns in place: Alembic rebuilds the table.
        render_as_batch=connection.dialect.name == "sqlite",
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_with_own_engine() -> None:
    """Open the store's migration engine, run the migrations and close it."""
    engine = create_migration_engine(DatabaseSettings(), create=True)
    try:
        async with engine.connect() as connection:
            await connection.run_sync(run_migrations)
    finally:
        await engine.dispose()


if context.is_offline_mode():
    raise RuntimeError("offline mode is not supported: migrations run against the database")

shared = config.attributes.get("connection")
if shared is not None:
    run_migrations(shared)
else:
    asyncio.run(run_with_own_engine())
