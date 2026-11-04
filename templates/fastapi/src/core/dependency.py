"""Tell a dependency being down apart from a fault in our own code.

The difference is a 503 against a 500, and they say opposite things: 503 means
"we are fine, something we need is not, come back", 500 means "we are broken". A
client should retry the first and report the second.

The check is an allowlist of what only a broken connection produces, wherever it
hides in the cause chain: a network error, a timeout, a PostgreSQL SQLSTATE of the
connection classes, psycopg's failed connect (a refused or dropped connection and a
connect timeout alike), a SQLAlchemy pool that has no connection to give, a SQLite
database that is busy, locked or cannot be opened, or a Redis client's connection or
timeout error. Anything unrecognised is not an outage, so a new failure mode arrives
as a 500 that gets investigated.
"""

import errno
import socket
from collections.abc import Iterator

#: Network errnos: the far end was not reached or went away mid-conversation.
_ERRNOS = {
    errno.ECONNREFUSED,
    errno.ECONNRESET,
    errno.ETIMEDOUT,
    errno.EPIPE,
    errno.EHOSTUNREACH,
    errno.ENETUNREACH,
}

#: SQLite result names, with their extended forms, that mean the database is not usable now.
_SQLITE_OUTAGE_PREFIXES = ("SQLITE_BUSY", "SQLITE_LOCKED", "SQLITE_CANTOPEN")

#: Client error classes that mean there is no connection to be had, by module and name.
#: A Redis client's errors subclass its own ``RedisError``, not the built-in
#: ``ConnectionError``, and SQLAlchemy's pool timeout is not the built-in ``TimeoutError``.
_CLIENT_OUTAGE_CLASSES = {
    ("redis.exceptions", "ConnectionError"),
    ("redis.exceptions", "TimeoutError"),
    ("sqlalchemy.exc", "TimeoutError"),
}

#: How far to follow a chain, so a cycle cannot spin.
_MAX_DEPTH = 6


def _chain(error: BaseException, depth: int = 0) -> Iterator[BaseException]:
    """Walk an error, its ``__cause__`` chain and the members of an exception group.

    Args:
        error: Whatever was raised.
        depth: Internal; how far down this call already is.

    Yields:
        The error and everything under it, outermost first.
    """
    yield error
    if depth >= _MAX_DEPTH:
        return
    if error.__cause__ is not None:
        yield from _chain(error.__cause__, depth + 1)
    if isinstance(error, BaseExceptionGroup):
        for member in error.exceptions:
            yield from _chain(member, depth + 1)


def _is_connection_sqlstate(state: object) -> bool:
    """Tell whether a SQLSTATE names a connection problem rather than a statement problem.

    Args:
        state: A driver's ``sqlstate`` or ``pgcode`` attribute.

    Returns:
        True for the ``08`` connection class, ``57P0`` (server going away) and ``53300``.
    """
    return isinstance(state, str) and (state.startswith(("08", "57P0")) or state == "53300")


def _is_sqlite_outage(link: BaseException) -> bool:
    """Tell whether an error is SQLite saying the database is busy, locked or cannot be opened.

    Args:
        link: One error in the chain.

    Returns:
        True for ``SQLITE_BUSY``, ``SQLITE_LOCKED``, ``SQLITE_CANTOPEN`` and their extended codes.
    """
    name = getattr(link, "sqlite_errorname", None)
    return isinstance(name, str) and name.startswith(_SQLITE_OUTAGE_PREFIXES)


def _is_client_outage(link: BaseException) -> bool:
    """Tell whether an error is a client failing for want of a connection.

    Args:
        link: One error in the chain.

    Returns:
        True for a Redis client's ``ConnectionError`` and ``TimeoutError`` families and
        for the timeout of SQLAlchemy's pool.
    """
    return any(
        (cls.__module__, cls.__name__) in _CLIENT_OUTAGE_CLASSES for cls in type(link).__mro__
    )


def _is_failed_connect(link: BaseException) -> bool:
    """Tell whether an error is psycopg failing to connect.

    The failure carries no sqlstate, errno or cause (tried on psycopg 3.3.8 against
    a closed port, a connection the server dropped and a server that never
    answered), so it is recognised by its module and class. A connect timeout is a
    subclass (``ConnectionTimeout``), so the whole class hierarchy is read. An
    ``OperationalError`` that has a sqlstate is a statement-level problem the server
    reported, such as a deadlock, and is not an outage.

    Args:
        link: One error in the chain.

    Returns:
        True for a sqlstate-less ``OperationalError`` of psycopg, or a subclass of it.
    """
    return getattr(link, "sqlstate", None) is None and any(
        cls.__module__.split(".")[0] == "psycopg" and cls.__name__ == "OperationalError"
        for cls in type(link).__mro__
    )


def is_outage_link(link: BaseException) -> bool:
    """Tell whether one error, taken alone, is a connection failure.

    Args:
        link: One error; its causes are not read.

    Returns:
        True when the error itself is a network error, a timeout, a connection-class
        SQLSTATE, a failed psycopg connect, a busy or unopenable SQLite database, or a
        client's connection or timeout error.
    """
    if isinstance(link, ConnectionError | TimeoutError | socket.gaierror):
        return True
    if isinstance(link, OSError) and link.errno in _ERRNOS:
        return True
    state = getattr(link, "sqlstate", None) or getattr(link, "pgcode", None)
    if _is_connection_sqlstate(state):
        return True
    return _is_sqlite_outage(link) or _is_client_outage(link) or _is_failed_connect(link)


def is_dependency_outage(error: BaseException) -> bool:
    """Tell whether a raised error means a dependency is unreachable.

    Args:
        error: Whatever was raised.

    Returns:
        True when any link of its cause chain is a connection failure.
    """
    return any(is_outage_link(link) for link in _chain(error))
