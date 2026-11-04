"""Logging, configured once: loguru to stdout, with the standard library routed into it."""

import logging
import sys

from loguru import logger

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


def configure_logging(level: str) -> None:
    """Configure logging for the process.

    Records go to stdout: under a container runtime that is the log. Tracebacks
    never include variable values (``diagnose=False``), because a value can be a
    secret.

    Args:
        level: The minimum level that is logged.
    """
    logger.remove()
    logger.add(sys.stdout, level=level, format=_FORMAT, backtrace=False, diagnose=False)
    logging.basicConfig(handlers=[InterceptHandler()], level=0, force=True)
