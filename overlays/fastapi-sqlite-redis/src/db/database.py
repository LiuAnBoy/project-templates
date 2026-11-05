"""SQLite: the settings, the factory behind ``create_database`` and the migration engine.

This is the one module that names SQLite. Everything else takes the
:class:`~db.types.DatabasePort` that :func:`create_database` returns.

The store holds two engines. Reads default to one, whose connections are
``query_only``, so a write through it fails instead of landing outside a
transaction. ``transactions.run`` takes the other, which has a single connection
that serialises the writers of this process, and begins each transaction with
``BEGIN IMMEDIATE``, so a read-then-write cannot fail on a lock upgrade.
"""

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import quote

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import Connection, event, text
from sqlalchemy.engine import URL
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import AsyncAdaptedQueuePool, NullPool

from core.dependency import DependencyClosedError
from db.nesting_guard import NestingGuard
from db.session_end import EndingSession, retire_driver_connections, run_in_session
from db.types import DatabasePort, MigrationError, TransactionRunner

# aiosqlite logs every statement together with its bound values at DEBUG, and the
# server routes the standard library's records into its own log. Pin it above DEBUG
# so that no log line holds a bound value, whatever LOG_LEVEL says.
logging.getLogger("aiosqlite").setLevel(logging.WARNING)

#: Refuses a ``transactions.run`` from inside an open one.
_GUARD = NestingGuard("sqlite")


class DatabaseSettings(BaseSettings):
    """The settings of the database; required, so a missing one stops the boot.

    ``core.config.Settings`` extends this through ``infra.settings``. A validation
    message never repeats the value.

    Attributes:
        database_url: The path of the database file, relative to the directory the
            server starts in. The file must already exist: only ``make db-migrate``
            and ``make db-generate`` create it.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
        case_sensitive=False,
        hide_input_in_errors=True,
        validate_by_name=True,
        validate_by_alias=True,
    )

    # The alias names the variable in an error: `DATABASE_URL`, not `database_url`.
    database_url: str = Field(alias="DATABASE_URL", min_length=1)

    @field_validator("database_url")
    @classmethod
    def _check_path(cls, value: str) -> str:
        """Refuse what is not the path of a file.

        Args:
            value: The raw setting.

        Returns:
            The setting, unchanged.

        Raises:
            ValueError: For ``:memory:``, which the two connections cannot share, and for
                a URI, which the store builds itself.
        """
        if value.startswith((":", "file:")) or "://" in value:
            raise ValueError("must be the path of a database file")
        return value


class DatabaseConfig(Protocol):
    """What ``create_database`` reads of the validated settings."""

    database_url: str


@dataclass(frozen=True)
class DatabaseOptions:
    """Settings that tests and unusual deployments may change.

    Attributes:
        busy_timeout_ms: How long a connection waits for a lock another process holds.
        write_wait_seconds: How long ``run`` waits for the write connection of this
            process before it fails as a busy store.
    """

    busy_timeout_ms: int = 5000
    write_wait_seconds: float = 5.0


def _uri_url(path: str) -> URL:
    """Build the URL that opens an existing file and never creates one.

    A plain URL creates a new empty file, so a wrong path would start an empty
    database. ``mode=rw`` makes SQLite fail with ``SQLITE_CANTOPEN`` instead.

    Args:
        path: The database file.

    Returns:
        A SQLAlchemy URL for ``aiosqlite``.
    """
    return URL.create(
        "sqlite+aiosqlite",
        database=f"file:{quote(path, safe='/')}",
        query={"mode": "rw", "uri": "true"},
    )


def _on_connect(engine: AsyncEngine, *, busy_timeout_ms: int, read_only: bool) -> None:
    """Set the pragmas of every new connection of an engine.

    Args:
        engine: The engine.
        busy_timeout_ms: How long to wait for another process's lock.
        read_only: Whether the connection may only read.
    """

    @event.listens_for(engine.sync_engine, "connect")
    def set_pragmas(dbapi_connection: Any, _record: Any) -> None:
        if not read_only:
            # Transactions begin through the "begin" event below, not through the driver.
            dbapi_connection.isolation_level = None
        cursor = dbapi_connection.cursor()
        cursor.execute(f"PRAGMA busy_timeout = {int(busy_timeout_ms)}")
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.execute("PRAGMA journal_mode = WAL")
        if read_only:
            cursor.execute("PRAGMA query_only = ON")
        cursor.close()

    if not read_only:

        @event.listens_for(engine.sync_engine, "begin")
        def begin_immediate(connection: Connection) -> None:
            connection.exec_driver_sql("BEGIN IMMEDIATE")


class _Runner:
    """Runs a unit of work in a transaction on the single writing connection."""

    def __init__(
        self, sessions: async_sessionmaker[AsyncSession], is_closed: Callable[[], bool]
    ) -> None:
        """Create a runner.

        Args:
            sessions: Opens the session on the writing engine.
            is_closed: Tells whether the database was closed; a closed one runs nothing.
        """
        self._sessions = sessions
        self._is_closed = is_closed

    async def run[T](self, work: Callable[[AsyncSession], Awaitable[T]]) -> T:
        """Run the work in a transaction.

        Writers wait for each other for ``write_wait_seconds`` and then fail as a
        busy store. A nested call is refused at once
        (:class:`~db.nesting_guard.NestingGuard`), because it would wait for a connection
        its own caller holds and stop every write until a restart. The session ends with
        the work (:func:`~db.session_end.run_in_session`), so a session kept from it can
        never take the writer again.

        Args:
            work: The unit of work; it receives the session of the transaction.

        Returns:
            What ``work`` returned, once the transaction has committed.

        Raises:
            RuntimeError: When called from inside another open ``run``.
            ConnectionError: When the database was closed.
        """
        if self._is_closed():
            raise DependencyClosedError("sqlite: the database is closed")

        async def on_the_writer(session: AsyncSession) -> T:
            # A session takes its connection at the first statement; take it now, so the
            # wait for the writer happens before the work starts, not somewhere inside it.
            await session.connection()
            return await work(session)

        async with _GUARD.entered():
            return await run_in_session(self._sessions, on_the_writer)


def create_database(config: DatabaseConfig, options: DatabaseOptions | None = None) -> DatabasePort:
    """Create the two engines, the transaction runner, a probe and a close.

    Nothing opens the file here: the connections open on first use, with
    ``mode=rw``, so a wrong path fails the startup check with ``SQLITE_CANTOPEN``
    and creates nothing. The pragmas are ``busy_timeout``, ``foreign_keys`` and
    ``journal_mode = WAL``. The engines hide bound parameters. After ``close`` the
    probe and the runner fail with a ``ConnectionError``, which the classifier answers
    as an outage.

    Args:
        config: The validated settings.
        options: Timeouts, for tests.

    Returns:
        The database port.
    """
    chosen = options or DatabaseOptions()
    url = _uri_url(config.database_url)
    reader = create_async_engine(url, hide_parameters=True)
    writer = create_async_engine(
        url,
        poolclass=AsyncAdaptedQueuePool,
        pool_size=1,
        max_overflow=0,
        pool_timeout=chosen.write_wait_seconds,
        hide_parameters=True,
    )
    _on_connect(reader, busy_timeout_ms=chosen.busy_timeout_ms, read_only=True)
    _on_connect(writer, busy_timeout_ms=chosen.busy_timeout_ms, read_only=False)
    retire_driver_connections(reader)
    retire_driver_connections(writer)

    closed = False

    async def probe() -> None:
        if closed:
            raise DependencyClosedError("sqlite: the database is closed")
        async with reader.connect() as connection:
            await connection.execute(text("select 1"))

    async def close() -> None:
        nonlocal closed
        closed = True
        await writer.dispose()
        await reader.dispose()

    transactions: TransactionRunner = _Runner(
        async_sessionmaker(writer, class_=EndingSession, expire_on_commit=False), lambda: closed
    )
    return DatabasePort(
        name="sqlite",
        session_factory=async_sessionmaker(reader, class_=EndingSession, expire_on_commit=False),
        transactions=transactions,
        probe=probe,
        close=close,
    )


def create_migration_engine(settings: DatabaseSettings, *, create: bool) -> AsyncEngine:
    """Create the engine ``make db-migrate`` and ``make db-generate`` use.

    Foreign keys stay off while migrating. A migration that rebuilds a parent table
    (Alembic's batch mode does, because SQLite cannot alter most columns in place)
    drops it, and with enforcement on the drop silently deletes the child rows that
    ``ON DELETE CASCADE`` points at. :func:`verify_migrated` takes the place of the
    enforcement. Every transaction begins explicitly with ``BEGIN``, so the DDL of a
    revision joins it: the driver's own handling leaves DDL outside any transaction,
    and a revision that fails halfway would keep its tables and fail again on every
    rerun. The pragma is set when the connection opens, before any ``BEGIN``, because
    ``PRAGMA foreign_keys`` does nothing inside a transaction.

    Args:
        settings: The database settings.
        create: Whether the file, and its folder, may be created when missing.

    Returns:
        An engine with no pool, which hides bound parameters.
    """
    path = settings.database_url
    if create:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        url = URL.create("sqlite+aiosqlite", database=path)
    else:
        url = _uri_url(path).update_query_dict({"mode": "ro"})
    engine = create_async_engine(url, poolclass=NullPool, hide_parameters=True)

    @event.listens_for(engine.sync_engine, "connect")
    def set_pragmas(dbapi_connection: Any, _record: Any) -> None:
        dbapi_connection.isolation_level = None
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA busy_timeout = 5000")
        cursor.execute("PRAGMA foreign_keys = OFF")
        cursor.close()

    @event.listens_for(engine.sync_engine, "begin")
    def begin(connection: Connection) -> None:
        connection.exec_driver_sql("BEGIN")

    return engine


def database_exists(settings: DatabaseSettings) -> bool:
    """Tell whether the file exists; ``make db-status`` never creates it.

    Args:
        settings: The database settings.

    Returns:
        True when the file exists.
    """
    return Path(settings.database_url).is_file()


def verify_migrated(connection: Connection) -> None:
    """Fail when the data breaks a foreign key.

    Runs after every migration and also when nothing is pending, so a violation a
    migration left behind keeps failing until it is fixed. It never writes.

    Args:
        connection: A synchronous view of the migration connection.

    Raises:
        MigrationError: Naming the tables that hold rows with no parent.
    """
    violations = connection.exec_driver_sql("PRAGMA foreign_key_check").all()
    if violations:
        tables = sorted({str(row[0]) for row in violations})
        raise MigrationError(
            f"The database holds rows that break a foreign key ({len(violations)} in "
            f"{', '.join(tables)}). A migration that is already applied cannot be undone: "
            "fix the data, or add a migration that does."
        )
