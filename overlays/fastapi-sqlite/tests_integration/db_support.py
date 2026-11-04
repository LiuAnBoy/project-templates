"""A throwaway database file for the store tests, and a table to write to."""

import sqlite3
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from db.types import TransactionRunner


@contextmanager
def database_file() -> Iterator[Path]:
    """Create an empty database file of its own, with the probe table, and remove it after.

    Yields:
        The path of the file. It lives in a temporary folder, so a test never touches
        the project's own database.
    """
    with tempfile.TemporaryDirectory(prefix="store-test-") as folder:
        path = Path(folder) / "test.db"
        connection = sqlite3.connect(path)
        connection.execute("create table probe (id text primary key)")
        connection.commit()
        connection.close()
        yield path


async def insert(session: AsyncSession, id_: str) -> None:
    """Insert one row of the probe table through a session the caller holds.

    Args:
        session: A session of the database under test.
        id_: The row's id.
    """
    await session.execute(text("insert into probe (id) values (:id)"), {"id": id_})


async def exists(session: AsyncSession, id_: str) -> bool:
    """Tell whether a row is visible to a session.

    Args:
        session: A session of the database under test.
        id_: The row's id.

    Returns:
        True when the row is there.
    """
    found = await session.execute(text("select 1 from probe where id = :id"), {"id": id_})
    return found.first() is not None


@contextmanager
def database_url() -> Iterator[str]:
    """Give the setting that names a database file of its own, with the probe table.

    Yields:
        The value for ``DATABASE_URL``; the file is removed after.
    """
    with database_file() as path:
        yield str(path)


class Probe:
    """The probe table of :func:`database_file`, through the same calls as the other stores'."""

    insert = staticmethod(insert)
    exists = staticmethod(exists)


async def create_probe(transactions: TransactionRunner) -> Probe:
    """Give the probe table of the file, which :func:`database_file` created already.

    Args:
        transactions: The runner of the database under test; unused here.

    Returns:
        The probe.
    """
    return Probe()


async def drop_probe(transactions: TransactionRunner, probe: Probe) -> None:
    """Remove nothing: the file goes away with its folder.

    Args:
        transactions: The runner of the database under test.
        probe: The probe.
    """
