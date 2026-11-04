"""Tell a dependency being down apart from a fault in our own code.

The difference is a 503 against a 500, and they say opposite things: 503 means
"we are fine, something we need is not, come back", 500 means "we are broken". A
client should retry the first and report the second.

The check is an allowlist of what only a broken connection produces, wherever it
hides in the cause chain: a network error, a timeout, or a PostgreSQL SQLSTATE of
the connection classes. Anything unrecognised is not an outage, so a new failure
mode arrives as a 500 that gets investigated.
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
    return False
