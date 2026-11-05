"""Tell a dependency that cannot be used apart from a fault in our own code.

The difference is a 503 against a 500, and they say opposite things: 503 means
"we are fine, something we need is not, come back", 500 means "we are broken". A
client should retry the first and report the second.

The check is an allowlist of what only the connection layer produces, wherever it
hides in the cause chain: a network error, a timeout, a TLS failure, a PostgreSQL
SQLSTATE of the connection classes, a refused login or database, a ``FATAL`` reply of
the server, psycopg's failed connect (a refused or dropped connection, a rejected
password and a connect timeout alike), a SQLAlchemy pool that has no connection to
give, a SQLite database that is busy, locked or cannot be opened, or a Redis client's
connection or timeout error. A wrong password is on the list because the answer to a
client is the same as for a server that is down: this request cannot be served and
nothing about it is wrong. A constraint violation, a syntax error and anything
unrecognised are not on the list, so a new failure mode arrives as a 500 that gets
investigated.
"""

import errno
import socket
import ssl
from collections.abc import Iterator

#: Network errnos: the far end was not reached or went away mid-conversation.
_ERRNOS = {
    errno.ECONNREFUSED,
    errno.ECONNRESET,
    errno.ETIMEDOUT,
    errno.EPIPE,
    errno.EHOSTUNREACH,
    errno.ENETUNREACH,
    errno.ENETDOWN,
    errno.EHOSTDOWN,
    errno.ECONNABORTED,
    errno.EPROTO,
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


class FixedTextError(Exception):
    """An error whose message we wrote ourselves and which holds no value.

    A fixed sentence that may name a dependency, never a host, a path or anything from
    a setting. It is the one error ``core.failure`` prints in full whatever its class says.
    """


class DependencyTimeoutError(FixedTextError, TimeoutError):
    """A dependency did not answer within a deadline."""


class DependencyClosedError(FixedTextError, ConnectionError):
    """A store was used after its ``close``."""


def read_attribute(link: BaseException, name: str) -> object:
    """Read an attribute of a raised error without letting it raise.

    This runs inside the error handler, where a second error means the response is
    never sent, and anything can be raised, a property that fails included.

    Args:
        link: One error in the chain.
        name: The attribute.

    Returns:
        The value, or None when it is missing or reading it failed.
    """
    try:
        return getattr(link, name, None)
    except Exception:
        return None


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
        True for the ``08`` connection class, ``57P0`` (server going away), ``53300`` (a full
        connection limit), ``28`` (a refused login) and ``3D000`` (an unknown database).
    """
    return isinstance(state, str) and (
        state.startswith(("08", "57P0", "28")) or state in ("53300", "3D000")
    )


def _is_fatal_reply(link: BaseException) -> bool:
    """Tell whether PostgreSQL ended the connection with this error.

    Args:
        link: One error in the chain.

    Returns:
        True when the server's severity is ``FATAL`` or ``PANIC``.
    """
    severity = getattr(read_attribute(link, "diag"), "severity_nonlocalized", None)
    return severity in ("FATAL", "PANIC")


def _is_sqlite_outage(link: BaseException) -> bool:
    """Tell whether an error is SQLite saying the database is busy, locked or cannot be opened.

    Args:
        link: One error in the chain.

    Returns:
        True for ``SQLITE_BUSY``, ``SQLITE_LOCKED``, ``SQLITE_CANTOPEN`` and their extended codes.
    """
    name = read_attribute(link, "sqlite_errorname")
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
    return read_attribute(link, "sqlstate") is None and any(
        cls.__module__.split(".")[0] == "psycopg" and cls.__name__ == "OperationalError"
        for cls in type(link).__mro__
    )


def is_outage_link(link: BaseException) -> bool:
    """Tell whether one error, taken alone, is a connection failure.

    Args:
        link: One error; its causes are not read.

    Returns:
        True when the error itself is a network error, a timeout, a TLS failure, a
        connection-class SQLSTATE, a ``FATAL`` reply, a failed psycopg connect, a busy or
        unopenable SQLite database, or a client's connection or timeout error.
    """
    if isinstance(link, ConnectionError | TimeoutError | socket.gaierror | ssl.SSLError):
        return True
    if isinstance(link, OSError) and link.errno in _ERRNOS:
        return True
    state = read_attribute(link, "sqlstate") or read_attribute(link, "pgcode")
    if _is_connection_sqlstate(state):
        return True
    return (
        _is_fatal_reply(link)
        or _is_sqlite_outage(link)
        or _is_client_outage(link)
        or _is_failed_connect(link)
    )


def is_dependency_outage(error: BaseException) -> bool:
    """Tell whether a raised error means a dependency cannot be used.

    Args:
        error: Whatever was raised.

    Returns:
        True when any link of its cause chain is a connection failure.
    """
    return any(is_outage_link(link) for link in _chain(error))
