"""Request id and access log, as one pure ASGI middleware."""

import re
import time
import uuid

from loguru import logger
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

#: What the access log writes in place of a path no route matched.
UNMATCHED_ROUTE = "<unmatched>"

#: An upstream request id is accepted only when it is safe in a log line and a header.
_REQUEST_ID_RE = re.compile(r"[A-Za-z0-9._-]{8,128}")


def resolve_request_id(candidate: str | None) -> str:
    """Pick the id of a request: the caller's, if it is safe to repeat, or a new one.

    Args:
        candidate: Whatever arrived in ``x-request-id``.

    Returns:
        The id this request will be known by.
    """
    value = candidate.strip() if candidate else ""
    return value if _REQUEST_ID_RE.fullmatch(value) else str(uuid.uuid4())


def client_address(headers: Headers) -> str:
    """Read the client address a rate limit or a log line counts against.

    Only correct behind a reverse proxy that overwrites ``x-forwarded-for``
    instead of forwarding what the client sent. ``unknown`` is a real bucket.

    Args:
        headers: The request headers.

    Returns:
        The first forwarded address, the real-ip header, or ``unknown``.
    """
    forwarded = (headers.get("x-forwarded-for") or "").split(",")[0].strip()
    return forwarded or (headers.get("x-real-ip") or "").strip() or "unknown"


def route_pattern(scope: Scope) -> str:
    """Build the route pattern of a request, such as ``/api/v1/items/{item_id}``.

    FastAPI keeps only the router-relative path on the matched route (the prefix
    lives in private include state), so the pattern is rebuilt from the concrete
    path by replacing each path parameter value with its ``{name}``. A value that
    cannot be found in the path would leak into the log, so the placeholder is
    returned instead.

    Args:
        scope: The ASGI scope, after routing.

    Returns:
        The pattern, or ``UNMATCHED_ROUTE`` when no route matched.
    """
    if scope.get("route") is None:
        return UNMATCHED_ROUTE
    path: str = scope["path"]
    for name, value in reversed(list(scope.get("path_params", {}).items())):
        text = str(value)
        index = path.rfind(text) if text else -1
        if index < 0:
            return UNMATCHED_ROUTE
        path = f"{path[:index]}{{{name}}}{path[index + len(text) :]}"
    return path


class RequestContextMiddleware:
    """Echo a safe request id on every response and write one access log line.

    The log names the route pattern (``/api/v1/items/{item_id}``), never the
    concrete URL, because a path parameter can be a credential. A request that
    matched nothing is logged as ``UNMATCHED_ROUTE``. Authorization headers and
    bodies are never logged.
    """

    def __init__(self, app: ASGIApp) -> None:
        """Wrap an application.

        Args:
            app: The next ASGI application.
        """
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Handle one ASGI call.

        Args:
            scope: The ASGI scope.
            receive: The ASGI receive channel.
            send: The ASGI send channel.
        """
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        request_id = resolve_request_id(headers.get("x-request-id"))
        scope.setdefault("state", {})["request_id"] = request_id
        started = time.perf_counter()
        status = 500

        async def send_with_id(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                MutableHeaders(scope=message)["x-request-id"] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        finally:
            logger.info(
                "request completed method={method} route={route} status={status} "
                "duration_ms={duration_ms} request_id={request_id} client={client}",
                method=scope["method"],
                route=route_pattern(scope),
                status=status,
                duration_ms=round((time.perf_counter() - started) * 1000),
                request_id=request_id,
                client=client_address(headers),
            )
