"""Per-client request limit, as one pure ASGI middleware.

The counts live in a ``limits`` storage, which is the port: this module is given
one and never builds it. :func:`create_memory_storage` is the default, one
process's memory; an implementation shared across instances, which the infra seam
hands to ``create_app``, replaces it and nothing else changes. A storage that cannot
be reached fails closed: the request is answered 503 in the failure envelope. The
middleware sits outside the exception handlers, so it answers that itself.
"""

import math
import time
from collections.abc import Collection
from ipaddress import (
    IPv4Network,
    IPv6Address,
    IPv6Network,
    ip_address,
    ip_network,
)

from limits import RateLimitItemPerSecond
from limits.aio.storage import MemoryStorage, Storage
from limits.aio.strategies import FixedWindowRateLimiter
from loguru import logger
from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from core.dependency import is_dependency_outage
from core.envelope import failure
from core.errors import FAILURES

#: The ranges a named entry of ``TRUST_PROXY`` stands for, as in Fastify's ``trustProxy``.
_NAMED_RANGES: dict[str, tuple[str, ...]] = {
    "loopback": ("127.0.0.0/8", "::1/128"),
    "linklocal": ("169.254.0.0/16", "fe80::/10"),
    "uniquelocal": ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"),
}

#: The part of an IPv6 address that names one subscriber; the rest is one client's own to vary.
_IPV6_PREFIX = 64

type Network = IPv4Network | IPv6Network


def parse_trusted_proxies(raw: str) -> tuple[Network, ...]:
    """Read the ``TRUST_PROXY`` setting.

    Unset, empty or ``false`` means no proxy is trusted: the client is the socket
    address and a forwarded header is ignored. Otherwise it is a comma-separated
    list of the addresses or ranges of the proxies in front of the server, and the
    forwarded header is believed only on a connection from one of them. A blanket
    value (``true``, ``*``, ``0.0.0.0/0``) or a bare number is refused, because it
    lets any caller choose the address the limit counts.

    Args:
        raw: The raw setting.

    Returns:
        The trusted networks, empty when none is trusted.

    Raises:
        ValueError: When an entry is a blanket trust or not an address or range.
    """
    value = raw.strip()
    if value == "" or value.lower() == "false":
        return ()
    networks: list[Network] = []
    for entry in (part.strip() for part in value.split(",")):
        for candidate in _NAMED_RANGES.get(entry, (entry,)):
            try:
                network = ip_network(candidate, strict=False)
            except ValueError:
                network = None
            if network is None or network.prefixlen == 0:
                raise ValueError(
                    "TRUST_PROXY is a comma-separated list of specific proxy addresses or ranges, "
                    "never a blanket value or a count"
                )
            networks.append(network)
    return tuple(networks)


def _is_trusted(address: str, trusted: Collection[Network]) -> bool:
    """Tell whether an address belongs to a trusted proxy.

    An IPv4-mapped IPv6 address is judged as the IPv4 address it wraps, because a
    server listening on ``::`` sees an IPv4 proxy that way.

    Args:
        address: A peer or forwarded address; not necessarily valid.
        trusted: The trusted networks.

    Returns:
        True when the address parses and lies in one of the networks.
    """
    try:
        parsed = ip_address(address)
    except ValueError:
        return False
    if isinstance(parsed, IPv6Address) and parsed.ipv4_mapped is not None:
        parsed = parsed.ipv4_mapped
    return any(parsed.version == network.version and parsed in network for network in trusted)


def _normalise(address: str) -> str:
    """Give an address the form one client always has.

    An IPv4-mapped IPv6 address becomes the IPv4 address, and an IPv6 address
    becomes its ``/64`` network, so a client that owns a whole ``/64`` cannot take a
    fresh bucket for each address in it.

    Args:
        address: A valid IP address.

    Returns:
        The key part naming the client.
    """
    parsed = ip_address(address)
    if isinstance(parsed, IPv6Address):
        if parsed.ipv4_mapped is not None:
            return str(parsed.ipv4_mapped)
        return str(ip_network(f"{parsed}/{_IPV6_PREFIX}", strict=False).network_address)
    return str(parsed)


def _forwarded_client(scope: Scope, trusted: Collection[Network]) -> str | None:
    """Find the client named by ``x-forwarded-for``, walking from the right.

    Args:
        scope: The ASGI scope.
        trusted: The trusted proxy networks.

    Returns:
        The first address, from the right, that is not a trusted proxy; the
        leftmost one when every address is trusted; None without the header.
    """
    forwarded = [
        part.strip()
        for value in Headers(scope=scope).getlist("x-forwarded-for")
        for part in value.split(",")
    ]
    for candidate in reversed(forwarded):
        if not _is_trusted(candidate, trusted):
            return candidate
    return forwarded[0] if forwarded else None


def client_key(scope: Scope, trusted: Collection[Network]) -> str:
    """Decide which client a request counts against.

    The socket address, unless the connection comes from a trusted proxy. Then
    ``x-forwarded-for`` is walked from the right, past every trusted proxy, and the
    first address that is not one is the client. A forwarded header from any other
    connection is free text and is ignored, and so is a forwarded value that is not
    an address. This is the limiter's own decision; the access log still prints
    ``core.middleware.client_address``.

    Args:
        scope: The ASGI scope.
        trusted: The trusted proxy networks, empty to trust none.

    Returns:
        The key of the client; ``unknown`` when the server has no peer address.
    """
    client = scope.get("client")
    peer = client[0] if client else "unknown"
    address = peer
    if trusted and _is_trusted(peer, trusted):
        address = _forwarded_client(scope, trusted) or peer
    try:
        return _normalise(address)
    except ValueError:
        return peer


def create_memory_storage() -> Storage:
    """Create the default storage: counts in one process's memory.

    A second instance counts on its own, so a deployment with more than one
    needs a storage they share, passed to the middleware in place of this one.

    Returns:
        A ``limits`` storage.
    """
    return MemoryStorage()


class RateLimitMiddleware:
    """Answer 429 once a client has made too many requests in a window.

    One fixed window per client, counted across every route. The answer is the
    failure table's ``too_many_requests`` in the failure envelope, with
    ``Retry-After``. A path in ``exempt_paths`` (a probe, say) is neither counted nor
    refused; nothing is exempt by default. When the storage cannot be reached (an
    error :func:`core.dependency.is_dependency_outage` accepts) the request is
    refused with the table's ``unavailable`` 503 instead of passing unlimited; any
    other storage error is a bug and propagates.
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        storage: Storage,
        max_requests: int,
        window_seconds: int,
        trusted_proxies: Collection[Network] = (),
        exempt_paths: Collection[str] = (),
    ) -> None:
        """Wrap an application.

        Args:
            app: The next ASGI application.
            storage: Where the counts live; the port.
            max_requests: Requests allowed per client in one window.
            window_seconds: The window, in seconds.
            trusted_proxies: Proxy networks whose ``x-forwarded-for`` is believed.
            exempt_paths: Exact request paths the limit skips.
        """
        self.app = app
        self._item = RateLimitItemPerSecond(max_requests, window_seconds)
        self._limiter = FixedWindowRateLimiter(storage)
        self._trusted = tuple(trusted_proxies)
        self._exempt = frozenset(exempt_paths)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Handle one ASGI call.

        Args:
            scope: The ASGI scope.
            receive: The ASGI receive channel.
            send: The ASGI send channel.
        """
        if scope["type"] != "http" or scope["path"] in self._exempt:
            await self.app(scope, receive, send)
            return

        key = client_key(scope, self._trusted)
        try:
            allowed = await self._limiter.hit(self._item, key)
        except Exception as error:
            if not is_dependency_outage(error):
                raise
            logger.opt(exception=error).error("rate limit storage unreachable")
            status, message = FAILURES["unavailable"]
            await JSONResponse(failure(message), status_code=status)(scope, receive, send)
            return
        if allowed:
            await self.app(scope, receive, send)
            return

        window = await self._limiter.get_window_stats(self._item, key)
        retry_after = max(1, math.ceil(window.reset_time - time.time()))
        status, message = FAILURES["too_many_requests"]
        response = JSONResponse(
            failure(message), status_code=status, headers={"Retry-After": str(retry_after)}
        )
        await response(scope, receive, send)
