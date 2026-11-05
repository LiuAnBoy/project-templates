"""What every SQL store hands out, so services and repositories are written once.

A store's ``db/database.py`` exports ``create_database(config)`` returning a
:class:`DatabasePort`, and nothing else in the project names a store.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


class MigrationError(Exception):
    """A migration command failed for a reason that is safe to print."""


class TransactionRunner(Protocol):
    """Runs one unit of work in a transaction.

    The service owns the scope: it calls ``run``, passes the session to every
    repository call inside the callback, and the transaction commits when the
    callback returns and rolls back when it raises. A ``run`` called while the
    transaction is open from code running inside it, a task the callback started
    included, is refused at once, on every store; pass the session down instead. Once
    the transaction has ended, such code opens one of its own.
    """

    async def run[T](self, work: Callable[[AsyncSession], Awaitable[T]]) -> T:
        """Run the work in a transaction.

        Args:
            work: The unit of work; it receives the session of the transaction.

        Returns:
            What ``work`` returned, once the transaction has committed.

        Raises:
            Exception: Whatever ``work`` raised, after the rollback.
            RuntimeError: When called from inside another open ``run``.
        """
        ...


@dataclass(frozen=True)
class DatabasePort:
    """The database as ``create_database`` returns it.

    Attributes:
        name: Stable name of the store, used as the name of its dependency check.
        session_factory: Opens a session for reads and for statements that take a handle.
        transactions: The only way to open a transaction.
        probe: Returns when the store answers and raises when it does not; the caller
            bounds it.
        close: Releases the connections; safe to call twice.
    """

    name: str
    session_factory: async_sessionmaker[AsyncSession]
    transactions: TransactionRunner
    probe: Callable[[], Awaitable[None]]
    close: Callable[[], Awaitable[None]]
