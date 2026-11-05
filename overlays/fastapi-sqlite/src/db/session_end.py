"""How a session stops working, for every SQL store.

A session of ``transactions.run`` lives as long as its unit of work, and one of
``session_factory`` as long as its ``async with`` block. SQLAlchemy lets a closed session
begin again on its next statement, which takes a connection nothing returns: the
connection sits idle in transaction, and a pool of a few such connections starves. So
ending a session replaces the class of the objects handed out with one that refuses every
attribute. Nothing changes while the session is alive, so a statement costs nothing extra;
ending one costs a few assignments.

The driver's own connection is the one thing that outlives a session and cannot be told
apart from its next user, so the store retires it from the pool when code asked for it
(:func:`retire_driver_connections`).
"""

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
)
from sqlalchemy.orm import Session
from sqlalchemy.util import greenlet_spawn

from core.dependency import FixedTextError

#: What every use of a session after its end fails with.
TRANSACTION_ENDED_TEXT = (
    "the transaction has ended; use a session only inside its transactions.run or its "
    "async with block"
)


class TransactionEndedError(FixedTextError, RuntimeError):
    """A session was used after its end: a bug in the code that kept it, so it answers 500."""

    def __init__(self) -> None:
        """Create the error, whose message is fixed."""
        super().__init__(TRANSACTION_ENDED_TEXT)


def _refuse(self: object, name: str) -> Any:
    """Refuse an attribute of an object whose session has ended.

    Python's own attributes stay, and so does ``close``, because closing twice is harmless.

    Args:
        self: The ended object.
        name: The attribute.

    Returns:
        The attribute, when it is a dunder or ``close``.

    Raises:
        TransactionEndedError: For anything else.
    """
    if name.startswith("__") or name == "close":
        return object.__getattribute__(self, name)
    raise TransactionEndedError


class _EndedSyncSession(Session):
    """A synchronous session kept from one that ended."""

    __slots__ = ()
    __getattribute__ = _refuse

    def close(self) -> None:
        """Do nothing: the session is closed."""


class _EndedConnection(AsyncConnection):
    """A connection a session handed out."""

    __slots__ = ()
    __getattribute__ = _refuse

    async def close(self) -> None:
        """Do nothing: the session gave the connection back."""


async def _close_sync_session(session: Session) -> None:
    """Close a session and end what is left of it.

    Args:
        session: The synchronous session under the async one.
    """
    try:
        await greenlet_spawn(session.close)
    finally:
        session.__class__ = _EndedSyncSession


class EndingSession(AsyncSession):
    """The session every SQL store hands out; once ended, any use of it raises."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        """Create a session.

        Args:
            *args: What ``AsyncSession`` takes.
            **kwargs: What ``AsyncSession`` takes.
        """
        super().__init__(*args, **kwargs)
        self._handed_out: list[AsyncConnection] = []

    async def connection(self, *args: Any, **kwargs: Any) -> AsyncConnection:
        """Give the session's connection, and remember it so that it ends with the session.

        Args:
            *args: What ``AsyncSession.connection`` takes.
            **kwargs: What ``AsyncSession.connection`` takes.

        Returns:
            The connection.
        """
        connection = await super().connection(*args, **kwargs)
        self._handed_out.append(connection)
        return connection

    def end(self) -> None:
        """Refuse any further use of this session and of the connections it handed out."""
        for connection in self._handed_out:
            connection.__class__ = _EndedConnection
        self.__class__ = _EndedSession

    async def close(self) -> None:
        """Close the session for good, unlike ``AsyncSession.close``, which allows a reuse."""
        sync_session = self.sync_session
        self.end()
        await _close_sync_session(sync_session)


class _EndedSession(EndingSession):
    """A session that has ended."""

    __slots__ = ()
    __getattribute__ = _refuse

    async def close(self) -> None:
        """Do nothing: the session is closed, or its runner is about to close it."""


async def run_in_session[T](
    sessions: async_sessionmaker[AsyncSession], work: Callable[[AsyncSession], Awaitable[T]]
) -> T:
    """Run the work in a transaction on a session of its own, and end the session with it.

    The session ends the moment the work settles, before the commit or the rollback starts,
    so nothing the work left running can slip in between.

    Args:
        sessions: Opens an :class:`EndingSession`.
        work: The unit of work; it receives the session.

    Returns:
        What ``work`` returned, once the transaction has committed.
    """
    session = sessions()
    sync_session = session.sync_session
    try:
        async with session.begin():
            try:
                return await work(session)
            finally:
                session.end()  # type: ignore[attr-defined]
    finally:
        # Shielded as ``AsyncSession.__aexit__`` is: a cancelled caller still gives back
        # the connection.
        await asyncio.shield(asyncio.create_task(_close_sync_session(sync_session)))


#: One class per driver class, so a retired connection refuses like a session.
_ended_drivers: dict[type, type] = {}


def _end_driver_connection(driver: Any) -> None:
    """Refuse any further use of a driver's connection.

    Args:
        driver: The driver's connection, already closed.
    """
    cls = type(driver)
    # The finalizer goes too: the original would read refused attributes.
    members = {"__slots__": (), "__getattribute__": _refuse, "__del__": lambda self: None}
    driver.__class__ = _ended_drivers.setdefault(cls, type(f"Ended{cls.__name__}", (cls,), members))


def retire_driver_connections(engine: AsyncEngine) -> None:
    """Close a connection when it returns to the pool if code asked for the driver's own.

    Code that keeps ``driver_connection`` could otherwise write on the connection after
    the pool gave it to someone else, and no check can tell the two apart. The connection
    is closed instead, and the pool opens a new one, so asking for it costs one reconnect.
    Code that never asks pays nothing.

    Args:
        engine: The engine whose connections the store hands out.
    """
    dialect = engine.sync_engine.dialect
    asked_for: set[int] = set()
    get_driver_connection = dialect.get_driver_connection

    def noting_driver_connection(connection: Any) -> Any:
        asked_for.add(id(connection))
        return get_driver_connection(connection)

    dialect.get_driver_connection = noting_driver_connection  # type: ignore[method-assign]

    @event.listens_for(engine.sync_engine, "checkin")
    def retire(dbapi_connection: Any, record: Any) -> None:
        if dbapi_connection is None or id(dbapi_connection) not in asked_for:
            return
        asked_for.discard(id(dbapi_connection))
        driver = get_driver_connection(dbapi_connection)
        record.invalidate()
        _end_driver_connection(driver)
