"""Logging, configured once: loguru to stdout, with the standard library routed into it."""

import asyncio
import logging
import re
import sys
from typing import Any

from loguru import logger

from core.failure import format_failure

#: One line per record; ``extra`` carries the structured fields of the access log.
_FORMAT = "{time:YYYY-MM-DD HH:mm:ss.SSS} | {level: <8} | {message}"

#: Libraries that talk to a store. Their records format an error's text into the message
#: (``query cancellation failed: %s``), and that text can name the host or a value, so the
#: arguments of their records are left out. Their traceback goes through ``core.failure``.
_DRIVER_LOGGERS = ("psycopg", "sqlalchemy", "aiosqlite", "redis", "limits")

#: A placeholder in the format string of a standard-library record.
_PLACEHOLDER = re.compile(r"%[-#0 +]*\d*(?:\.\d+)?[a-zA-Z]")


class InterceptHandler(logging.Handler):
    """Route standard-library records (uvicorn, libraries) into loguru."""

    def emit(self, record: logging.LogRecord) -> None:
        """Forward one record to loguru.

        Args:
            record: The standard-library record.
        """
        try:
            level: str | int = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno
        if isinstance(record.msg, BaseException):
            # A server logs a failed bind as the error itself, whose text quotes the address.
            message = format_failure(record.msg).strip()
        elif record.name.split(".")[0] in _DRIVER_LOGGERS:
            message = _PLACEHOLDER.sub("<withheld>", str(record.msg))
        else:
            message = record.getMessage()
        logger.opt(exception=record.exc_info, depth=6).log(level, message)


def _describe_exception(record: Any) -> None:
    """Replace a record's exception with its safe description, in the message.

    Every traceback the process logs goes through here, whoever logged it (a handler,
    a middleware, uvicorn through the standard library), so none of them can print
    what a driver's error text carries: ``core.failure`` explains what is withheld.

    Args:
        record: The loguru record, changed in place.
    """
    exception = record["exception"]
    if exception is not None and exception.value is not None:
        record["message"] = f"{record['message']}\n{format_failure(exception.value)}".rstrip("\n")
        record["exception"] = None


def log_stray_failure(_loop: asyncio.AbstractEventLoop, context: dict[str, Any]) -> None:
    """Log what the event loop found nobody handling, such as a task that failed unseen.

    The loop's default handler prints the task's repr in the message, and the repr
    quotes the error's text. This one logs the loop's own sentence and the error, which
    goes through ``core.failure``. Installed by the lifespan, on the loop that serves.

    Args:
        _loop: The event loop.
        context: What the loop reports; ``message`` is its own, ``exception`` the error.
    """
    logger.opt(exception=context.get("exception")).error(
        "{message}", message=context.get("message", "unhandled failure in the event loop")
    )


def configure_logging(level: str) -> None:
    """Configure logging for the process.

    Records go to stdout: under a container runtime that is the log. Tracebacks
    never include variable values (``diagnose=False``), and the text of an error
    that carries one (see ``core.failure``) is withheld, because a value can be a
    secret.

    Args:
        level: The minimum level that is logged.
    """
    logger.remove()
    logger.configure(patcher=_describe_exception)
    logger.add(sys.stdout, level=level, format=_FORMAT, backtrace=False, diagnose=False)
    logging.basicConfig(handlers=[InterceptHandler()], level=0, force=True)
