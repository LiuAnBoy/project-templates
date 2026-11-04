"""Describe an error for the log without the values it carries.

A driver's error text can hold what the request sent or what the process was
configured with: a bound value in a failed statement or in the server's reply
about it (``invalid input syntax for type uuid: "..."``, the ``DETAIL`` of a unique
violation), and the host, user or path of a connection that could not be made. The
log is a place such text must not reach, so every traceback the process logs is
rendered here: the frames and the class of each link stay, and the message of a link
that carries such text is replaced by a fixed note.
"""

import ssl
import traceback
from collections import deque
from collections.abc import Iterator

from core.dependency import is_outage_link

#: SQLSTATE classes and states whose server message quotes a value or a name: 22 (data
#: exception) and 23 (integrity constraint violation, whose ``DETAIL`` names the key), 28
#: (invalid authorization, which names the user) and 3D000 (an unknown database, which
#: names it).
_MESSAGE_QUOTING_STATES = ("22", "23", "28", "3D000")

#: What replaces a message that is withheld.
_WITHHELD = "<message withheld>"


def walk_errors(error: BaseException) -> Iterator[BaseException]:
    """Walk an error and everything the traceback printer would also print.

    Args:
        error: Whatever was raised.

    Yields:
        The error, its causes and contexts and the members of an exception group,
        each once, the outermost first.
    """
    seen: set[int] = set()
    pending = deque([error])
    while pending:
        link = pending.popleft()
        if id(link) in seen:
            continue
        seen.add(id(link))
        yield link
        pending.extend(under for under in (link.__cause__, link.__context__) if under is not None)
        if isinstance(link, BaseExceptionGroup):
            pending.extend(link.exceptions)


def _withheld_texts(link: BaseException) -> list[str]:
    """Find the message texts of one link that must not be logged.

    A link that is a connection failure withholds its whole message, which names the
    host, the user, the database or the path, and so does a TLS failure, which quotes
    the name a certificate was checked against. A statement or a login that the server
    rejected, in a class whose message quotes a value or a name, withholds the driver's
    message, which SQLAlchemy repeats in its own; SQLAlchemy's statement text stays,
    and so do the parameters only when the engine was created with
    ``hide_parameters=True``, as every engine of the data overlays is.

    Args:
        link: One error in the chain.

    Returns:
        The texts to replace, possibly empty.
    """
    texts: list[str] = []
    if is_outage_link(link) or isinstance(link, ssl.SSLError):
        texts.append(str(link))
    original = getattr(link, "orig", None)
    for candidate in (link, original):
        if not isinstance(candidate, BaseException):
            continue
        state = getattr(candidate, "sqlstate", None) or getattr(candidate, "pgcode", None)
        if isinstance(state, str) and state.startswith(_MESSAGE_QUOTING_STATES):
            texts.append(str(candidate))
    return [text for text in texts if text]


def format_failure(error: BaseException) -> str:
    """Render an error and its causes as a traceback, minus the withheld messages.

    Args:
        error: Whatever was raised.

    Returns:
        The text ``traceback.format_exception`` gives, with the message of every
        connection and TLS failure and of every driver error that quotes a value or a name
        replaced.
    """
    text = "".join(traceback.format_exception(error))
    withheld = {item for link in walk_errors(error) for item in _withheld_texts(link)}
    for item in sorted(withheld, key=len, reverse=True):
        text = text.replace(item, _WITHHELD)
    return text
