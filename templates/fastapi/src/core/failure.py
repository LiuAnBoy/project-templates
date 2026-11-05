"""Describe an error for the log without the values it carries.

A driver's error text can hold what the request sent or what the process was
configured with: a bound value in a failed statement or in the server's reply
about it (``invalid input syntax for type uuid: "..."``, the ``DETAIL`` of a unique
violation), and the host, user or path of a connection that could not be made. The
log is a place such text must not reach, so every traceback the process logs is
rendered here: the frames and the class of each link stay, and the message of a link
that carries such text is replaced by a fixed note. The note keeps what tells two
failures apart and holds no value: the SQLSTATE, the name of a violated constraint, the
SQLite code, the errno or the TLS reason. A failed connect of psycopg carries no
SQLSTATE, so its note is read from the fixed words of libpq's and the server's text.
"""

import errno
import re
import ssl
import traceback
from collections import deque
from collections.abc import Iterator

from core.dependency import FixedTextError, is_outage_link, read_attribute

#: SQLSTATE classes and states whose server message quotes a value or a name: 22 (data
#: exception) and 23 (integrity constraint violation, whose ``DETAIL`` names the key), 28
#: (invalid authorization, which names the user) and 3D000 (an unknown database, which
#: names it).
_MESSAGE_QUOTING_STATES = ("22", "23", "28", "3D000")

#: What replaces a message that is withheld.
_WITHHELD = "<message withheld>"

#: What a message says, when the error has no code to say it with: the fixed words of
#: libpq and of the server, and the code a person would look up. The text is read here
#: and never printed. A server configured for another language matches none of them, and
#: the note is left out.
_KNOWN_TEXTS: tuple[tuple[re.Pattern[str], str], ...] = tuple(
    (re.compile(pattern, re.IGNORECASE), note)
    for pattern, note in (
        (r"password authentication failed", "SQLSTATE 28P01"),
        (r"no password supplied", "no password"),
        (r"no pg_hba\.conf entry", "SQLSTATE 28000"),
        (r'role ".*" does not exist', "SQLSTATE 28000"),
        (r'database ".*" does not exist', "SQLSTATE 3D000"),
        (r"too many (clients|connections)|remaining connection slots", "SQLSTATE 53300"),
        (r"the database system is", "SQLSTATE 57P03"),
        (r"connection refused|connect call failed", "ECONNREFUSED"),
        (r"connection reset|server closed the connection", "ECONNRESET"),
        (r"timeout expired|timed out", "ETIMEDOUT"),
        (r"translate host name|failed to resolve host|name or service not known", "ENOTFOUND"),
        (r"does not support ssl|ssl error|ssl syscall|certificate verify", "TLS"),
    )
)

#: What a name taken from the server's diagnostics may look like; anything else is left out.
_SAFE_NAME = re.compile(r"^[\w$.-]{1,128}$")


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


def _note_of(link: BaseException, text: str) -> str:
    """Say what a withheld message was about, without any value.

    Args:
        link: The error whose message is withheld.
        text: The withheld text.

    Returns:
        The note, or an empty string when nothing is known.
    """
    state = read_attribute(link, "sqlstate") or read_attribute(link, "pgcode")
    if isinstance(state, str):
        constraint = getattr(read_attribute(link, "diag"), "constraint_name", None)
        if isinstance(constraint, str) and _SAFE_NAME.match(constraint):
            return f"SQLSTATE {state}, constraint {constraint}"
        return f"SQLSTATE {state}"
    sqlite_name = read_attribute(link, "sqlite_errorname")
    if isinstance(sqlite_name, str):
        return sqlite_name
    reason = read_attribute(link, "reason")
    if isinstance(link, ssl.SSLError) and isinstance(reason, str):
        return f"TLS {reason}"
    if isinstance(link, OSError) and isinstance(link.errno, int):
        name = errno.errorcode.get(link.errno)
        if name is not None:
            return name
    for pattern, note in _KNOWN_TEXTS:
        if pattern.search(text):
            return note
    return ""


def _withheld_texts(link: BaseException) -> dict[str, str]:
    """Find the message texts of one link that must not be logged, and their notes.

    A link that is a connection failure withholds its whole message, which names the
    host, the user, the database or the path, and so does any ``OSError``, whose text
    names the path or the addresses it tried (asyncio's failed connect to a name with
    several addresses has no errno to recognise it by), and a TLS failure, which quotes
    the name a certificate was checked against. A statement or a login that the server
    rejected, in a class whose message quotes a value or a name, withholds the driver's
    message, which SQLAlchemy repeats in its own; SQLAlchemy's statement text stays,
    and so do the parameters only when the engine was created with
    ``hide_parameters=True``, as every engine of the data overlays is. A
    ``FixedTextError`` keeps its message: we wrote it, and it holds no value.

    Args:
        link: One error in the chain.

    Returns:
        The texts to replace, each with the note that goes in its place.
    """
    if isinstance(link, FixedTextError):
        return {}
    texts: dict[str, str] = {}
    if is_outage_link(link) or isinstance(link, OSError):
        texts[str(link)] = _note_of(link, str(link))
    original = read_attribute(link, "orig")
    for candidate in (link, original):
        if not isinstance(candidate, BaseException):
            continue
        state = read_attribute(candidate, "sqlstate") or read_attribute(candidate, "pgcode")
        if isinstance(state, str) and state.startswith(_MESSAGE_QUOTING_STATES):
            texts[str(candidate)] = _note_of(candidate, str(candidate))
    return {text: note for text, note in texts.items() if text}


def format_failure(error: BaseException) -> str:
    """Render an error and its causes as a traceback, minus the withheld messages.

    Args:
        error: Whatever was raised.

    Returns:
        The text ``traceback.format_exception`` gives, with the message of every
        connection and TLS failure and of every driver error that quotes a value or a name
        replaced by a fixed note.
    """
    text = "".join(traceback.format_exception(error))
    withheld = {
        item: note for link in walk_errors(error) for item, note in _withheld_texts(link).items()
    }
    for item in sorted(withheld, key=len, reverse=True):
        note = withheld[item]
        text = text.replace(item, f"{_WITHHELD} [{note}]" if note else _WITHHELD)
    return text
