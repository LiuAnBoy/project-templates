"""The exception handlers: the only place a failure answer is built.

Whoever raised the error, the client sees the failure table's text for it, never
a framework's own. The first match wins: an :class:`ApiError` (its own status and
message), a request that failed validation (400, the issues go to the debug log),
a framework ``HTTPException`` (the table message for its status), a dependency
outage (503) and anything else (logged with its whole cause chain, answered with
the fixed 500).
"""

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from loguru import logger
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse

from core.dependency import is_dependency_outage
from core.envelope import failure
from core.errors import FAILURES, ApiError, failure_for_status


def _answer(
    request: Request, status: int, message: str, headers: dict[str, str] | None = None
) -> JSONResponse:
    """Build a failure answer.

    Args:
        request: The request, for its id.
        status: The HTTP status.
        message: The fixed message.
        headers: Extra response headers (``Allow``, ``WWW-Authenticate``).

    Returns:
        The response with the failure envelope.
    """
    response = JSONResponse(failure(message), status_code=status, headers=headers)
    request_id = request.scope.get("state", {}).get("request_id")
    if request_id:
        response.headers["x-request-id"] = request_id
    return response


async def api_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Answer an :class:`ApiError` with its own status and message.

    Args:
        request: The request.
        exc: The error.

    Returns:
        The failure answer.
    """
    assert isinstance(exc, ApiError)
    return _answer(request, exc.status, exc.message)


async def validation_handler(request: Request, exc: Exception) -> JSONResponse:
    """Answer a request that failed validation with the fixed 400 text.

    The issue list goes to the debug log without the offending input, which can
    be a secret; the client never sees it.

    Args:
        request: The request.
        exc: The ``RequestValidationError``.

    Returns:
        The failure answer.
    """
    assert isinstance(exc, RequestValidationError)
    issues = [{"loc": error["loc"], "type": error["type"]} for error in exc.errors()]
    logger.debug("request failed validation issues={issues}", issues=issues)
    status, message = FAILURES["invalid_request"]
    return _answer(request, status, message)


async def http_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Answer a framework ``HTTPException`` (an unknown route, a wrong method).

    Args:
        request: The request.
        exc: The ``HTTPException``.

    Returns:
        The failure answer, with the table message for its status.
    """
    assert isinstance(exc, HTTPException)
    status, message = failure_for_status(exc.status_code)
    if exc.status_code >= 500:
        logger.opt(exception=exc).error("framework error status={status}", status=exc.status_code)
    allow = (exc.headers or {}).get("allow")
    return _answer(request, status, message, {"Allow": allow} if allow else None)


def unhandled_failure(exc: Exception) -> tuple[int, str]:
    """Decide what an unexpected error is answered with.

    The one place the decision is made: the handler below answers it, and the
    access log records the same status for a request that ends in it.

    Args:
        exc: Whatever was raised.

    Returns:
        The ``(status, message)`` entry: 503 for a dependency outage, otherwise the fixed 500.
    """
    return FAILURES["unavailable"] if is_dependency_outage(exc) else FAILURES["internal"]


async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
    """Answer anything unexpected: 503 for a dependency outage, otherwise the fixed 500.

    The full cause chain goes to the log; none of it reaches the answer.

    Args:
        request: The request.
        exc: Whatever was raised.

    Returns:
        The failure answer.
    """
    status, message = unhandled_failure(exc)
    if status == FAILURES["unavailable"][0]:
        logger.opt(exception=exc).error("dependency unreachable")
    else:
        logger.opt(exception=exc).error("unhandled error")
    return _answer(request, status, message)


def register_handlers(app: FastAPI) -> None:
    """Register every exception handler on the application.

    Args:
        app: The application.
    """
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(RequestValidationError, validation_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(Exception, unhandled_handler)
