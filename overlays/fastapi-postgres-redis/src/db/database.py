"""PostgreSQL: the settings, the factory behind ``create_database`` and the migration engine.

This is the one module that names PostgreSQL. Everything else takes the
:class:`~db.types.DatabasePort` that :func:`create_database` returns, so moving to
another SQL store replaces this file and the models' dialect-specific types.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Protocol

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import Connection, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from core.dependency import DependencyClosedError
from db.nesting_guard import NestingGuard
from db.types import DatabasePort, TransactionRunner

#: Refuses a ``transactions.run`` from inside an open one.
_GUARD = NestingGuard("postgres")


class DatabaseSettings(BaseSettings):
    """The settings of the database; required, so a missing one stops the boot.

    ``core.config.Settings`` extends this through ``infra.settings``. A validation
    message never repeats the value, which holds the password.

    Attributes:
        database_url: A plain ``postgresql://`` URL; the factory sets the driver.
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
    database_url: str = Field(alias="DATABASE_URL", pattern=r"^postgres(ql)?://")

    # The name is its own: `Settings` inherits every store's settings, and a validator with
    # the name of another store's would replace it without a word.
    @field_validator("database_url")
    @classmethod
    def _check_database_url(cls, value: str) -> str:
        """Refuse a URL that SQLAlchemy cannot turn into an engine.

        A port that is not a number, an unparsable authority and a repeated ``port``
        option fail when the engine is built, with a message that quotes the part that
        was wrong. Building the engine here, which never connects, stops the boot at the
        settings, where an error names the variable and never its value.

        Args:
            value: The raw setting.

        Returns:
            The setting, unchanged.

        Raises:
            ValueError: With a fixed message, whatever the engine raised.
        """
        try:
            create_async_engine(engine_url(value))
        except Exception:
            raise ValueError("must be a valid postgresql:// URL") from None
        return value


class DatabaseConfig(Protocol):
    """What ``create_database`` reads of the validated settings."""

    database_url: str


@dataclass(frozen=True)
class DatabaseOptions:
    """Settings that tests and unusual deployments may change.

    Attributes:
        connect_timeout_seconds: How long a connection attempt may take (libpq rounds
            anything below 2 up to 2).
        pool_size: How many connections the pool opens at most.
        pool_wait_seconds: How long a request waits for a free connection before it
            fails as an unavailable store.
    """

    connect_timeout_seconds: int = 5
    pool_size: int = 10
    pool_wait_seconds: float = 5.0


def engine_url(database_url: str) -> URL:
    """Name the driver in a plain PostgreSQL URL.

    Args:
        database_url: A ``postgresql://`` or ``postgres://`` URL.

    Returns:
        The same URL for SQLAlchemy's async ``psycopg`` driver.
    """
    return make_url(database_url).set(drivername="postgresql+psycopg")


class _Runner:
    """Runs a unit of work in a transaction on a session of its own."""

    def __init__(
        self, sessions: async_sessionmaker[AsyncSession], is_closed: Callable[[], bool]
    ) -> None:
        """Create a runner.

        Args:
            sessions: Opens the session each unit of work uses.
            is_closed: Tells whether the database was closed; a closed one runs nothing.
        """
        self._sessions = sessions
        self._is_closed = is_closed

    async def run[T](self, work: Callable[[AsyncSession], Awaitable[T]]) -> T:
        """Run the work in a transaction.

        A nested call is refused at once (:class:`~db.nesting_guard.NestingGuard`),
        because it would take a second connection and wait for locks its own caller
        holds, or exhaust the pool when several requests nest together.

        Args:
            work: The unit of work; it receives the session of the transaction.

        Returns:
            What ``work`` returned, once the transaction has committed.

        Raises:
            RuntimeError: When called from inside another open ``run``.
            ConnectionError: When the database was closed.
        """
        if self._is_closed():
            raise DependencyClosedError("postgres: the database is closed")
        async with _GUARD.entered(), self._sessions() as session, session.begin():
            return await work(session)


def create_database(config: DatabaseConfig, options: DatabaseOptions | None = None) -> DatabasePort:
    """Create the engine, the transaction runner, a probe and a close.

    Nothing connects here: the pool connects on first use, and the startup check
    of ``src/infra/`` is what proves the server is reachable. The factory does not
    read the environment and assumes nothing about where the server is. The engine
    hides bound parameters, so no statement error carries a value, and checks a
    pooled connection before it hands it out, so a restart of the server costs no
    request. After ``close`` the probe and the runner fail with a ``ConnectionError``,
    which the classifier answers as an outage. On a server that went silent, psycopg
    tries to cancel a query whose waiter was cancelled, gives up after a few seconds
    and closes the connection, so a probe that ``bounded()`` abandoned frees its slot.

    Args:
        config: The validated settings.
        options: Timeouts and the pool size, for tests.

    Returns:
        The database port.
    """
    chosen = options or DatabaseOptions()
    engine = create_async_engine(
        engine_url(config.database_url),
        pool_size=chosen.pool_size,
        max_overflow=0,
        pool_timeout=chosen.pool_wait_seconds,
        pool_pre_ping=True,
        hide_parameters=True,
        connect_args={"connect_timeout": chosen.connect_timeout_seconds},
    )
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    closed = False

    async def probe() -> None:
        if closed:
            raise DependencyClosedError("postgres: the database is closed")
        async with engine.connect() as connection:
            await connection.execute(text("select 1"))

    async def close() -> None:
        nonlocal closed
        closed = True
        await engine.dispose()

    transactions: TransactionRunner = _Runner(sessions, lambda: closed)
    return DatabasePort(
        name="postgres",
        session_factory=sessions,
        transactions=transactions,
        probe=probe,
        close=close,
    )


def create_migration_engine(settings: DatabaseSettings, *, create: bool) -> AsyncEngine:
    """Create the engine ``make db-migrate`` and ``make db-generate`` use.

    Args:
        settings: The database settings.
        create: Whether the store may be created when missing; a PostgreSQL database
            is created by hand beforehand, so this changes nothing here.

    Returns:
        An engine with no pool, which hides bound parameters.
    """
    return create_async_engine(
        engine_url(settings.database_url),
        poolclass=NullPool,
        hide_parameters=True,
        connect_args={"connect_timeout": 10},
    )


def database_exists(settings: DatabaseSettings) -> bool:
    """Tell whether there is anything to read; ``make db-status`` skips a store that is missing.

    Args:
        settings: The database settings.

    Returns:
        Always True: a server is reached, and a missing database is a connection failure.
    """
    return True


def verify_migrated(connection: Connection) -> None:
    """Check what the store can check about its data after a migration.

    Args:
        connection: A synchronous view of the migration connection.
    """
    return None
