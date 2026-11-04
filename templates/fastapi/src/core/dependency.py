"""Tell a dependency being down apart from a fault in our own code.

The difference is a 503 against a 500, and they say opposite things: 503 means
"we are fine, something we need is not, come back", 500 means "we are broken". A
client should retry the first and report the second.

The check is an allowlist of what only a broken connection produces, wherever it
hides in the cause chain: a network error, a timeout, a PostgreSQL SQLSTATE of the
connection classes, psycopg's failed connect, a SQLite database that is busy, locked
or cannot be opened, or a Redis client's connection or timeout error. Anything
unrecognised is not an outage, so a new failure mode arrives as a 500 that gets
investigated.
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

#: Redis client error classes that mean there is no connection, by module and name. The
#: client's errors subclass its own ``RedisError``, not the built-in ``ConnectionError``.
_REDIS_OUTAGE_CLASSES = {
    ("redis.exceptions", "ConnectionError"),
    ("redis.exceptions", "TimeoutError"),
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


def _is_redis_outage(link: BaseException) -> bool:
    """Tell whether an error is a Redis client failing for want of a connection.

    Args:
        link: One error in the chain.

    Returns:
        True for the client's ``ConnectionError`` and ``TimeoutError`` families.
    """
    return any(
        (cls.__module__, cls.__name__) in _REDIS_OUTAGE_CLASSES for cls in type(link).__mro__
    )


def _is_failed_connect(link: BaseException) -> bool:
    """Tell whether an error is psycopg failing to connect.

    The failure carries no sqlstate, errno or cause (tried on psycopg 3.3.8 against
    a closed port), so it is recognised by its module and class. An
    ``OperationalError`` that has a sqlstate is a statement-level problem the server
    reported, such as a deadlock, and is not an outage.

    Args:
        link: One error in the chain.

    Returns:
        True for a sqlstate-less ``OperationalError`` of psycopg.
    """
    cls = type(link)
    return (
        cls.__module__.split(".")[0] == "psycopg"
        and cls.__name__ == "OperationalError"
        and getattr(link, "sqlstate", None) is None
    )


def is_dependency_outage(error: BaseException) -> bool:
    """Tell whether a raised error means a dependency is unreachable.

    Args:
        error: Whatever was raised.

    Returns:
        True when any link of its cause chain is a connection failure.
    """
    for link in _chain(error):
        if isinstance(link, ConnectionError | TimeoutError | socket.gaierror):
            return True
        if isinstance(link, OSError) and link.errno in _ERRNOS:
            return True
        state = getattr(link, "sqlstate", None) or getattr(link, "pgcode", None)
        if _is_connection_sqlstate(state):
            return True
        if _is_sqlite_outage(link) or _is_redis_outage(link) or _is_failed_connect(link):
            return True
    return False
