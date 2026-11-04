"""Logging, configured once: loguru to stdout, with the standard library routed into it."""

import logging
import sys
from typing import Any

from loguru import logger

from core.failure import format_failure

#: One line per record; ``extra`` carries the structured fields of the access log.
_FORMAT = "{time:YYYY-MM-DD HH:mm:ss.SSS} | {level: <8} | {message}"


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
        logger.opt(exception=record.exc_info, depth=6).log(level, record.getMessage())


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
