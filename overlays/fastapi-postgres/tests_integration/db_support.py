"""A throwaway schema for the store tests, and a table to write to."""

import secrets
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass
from types import SimpleNamespace

from local_target import require_local_url
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import create_database
from db.types import DatabasePort, TransactionRunner


@dataclass(frozen=True)
class Probe:
    """A table in a schema of its own, so a test never touches a shared one.

    Attributes:
        schema: The throwaway schema's name.
    """

    schema: str

    async def insert(self, session: AsyncSession, id_: str) -> None:
        """Insert one row through a session the caller holds.

        Args:
            session: A session of the database under test.
            id_: The row's id.
        """
        await session.execute(
            text(f'insert into "{self.schema}".probe (id) values (:id)'), {"id": id_}
        )

    async def exists(self, session: AsyncSession, id_: str) -> bool:
        """Tell whether a row is visible to a session.

        Args:
            session: A session of the database under test.
            id_: The row's id.

        Returns:
            True when the row is there.
        """
        found = await session.execute(
            text(f'select 1 from "{self.schema}".probe where id = :id'), {"id": id_}
        )
        return found.first() is not None


@contextmanager
def database_url() -> Iterator[str]:
    """Give the setting that names the database the store tests run against.

    Yields:
        ``TEST_DATABASE_URL``, which must name a local host.

    Raises:
        RuntimeError: When ``TEST_DATABASE_URL`` is missing or not local.
    """
    yield require_local_url("TEST_DATABASE_URL")


async def create_probe(transactions: TransactionRunner) -> Probe:
    """Create a probe table in a schema of its own, so a test never touches a shared one.

    Args:
        transactions: The runner of the database under test.

    Returns:
        The probe; give it to :func:`drop_probe` when the test is done.
    """
    schema = f"it_{secrets.token_hex(6)}"

    async def create(session: AsyncSession) -> None:
        await session.execute(text(f'create schema "{schema}"'))
        await session.execute(text(f'create table "{schema}".probe (id text primary key)'))

    await transactions.run(create)
    return Probe(schema)


async def drop_probe(transactions: TransactionRunner, probe: Probe) -> None:
    """Drop the probe's schema.

    Args:
        transactions: The runner of the database under test.
        probe: The probe.
    """

    async def drop(session: AsyncSession) -> None:
        await session.execute(text(f'drop schema "{probe.schema}" cascade'))

    await transactions.run(drop)


@asynccontextmanager
async def database_with_probe() -> AsyncIterator[tuple[DatabasePort, Probe]]:
    """Create the database of ``TEST_DATABASE_URL`` and a probe table in a schema of its own.

    Yields:
        The database and the probe. The schema is dropped, and the database closed, after.
    """
    with database_url() as url:
        database = create_database(SimpleNamespace(database_url=url))
        probe = await create_probe(database.transactions)
        try:
            yield database, probe
        finally:
            await drop_probe(database.transactions, probe)
            await database.close()
