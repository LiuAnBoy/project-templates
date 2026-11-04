"""What the process depends on, as ``create_infra`` hands it to ``create_app``."""

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass

from limits.aio.storage import Storage
from redis.asyncio import Redis

from core.dependency_checks import DependencyCheck


@dataclass(frozen=True)
class Infra:
    """The checks, the limiter storage, the close function and the Redis client.

    Attributes:
        checks: Run by the health route and, before the server listens, by the lifespan.
        rate_limit_storage: The shared storage of the rate limit; None keeps the
            counts in process memory.
        close: Releases what ``create_infra`` opened; awaited when the app shuts down.
        redis: The Redis client. None only in the stub that the ordinary tests install
            in place of the seam.
    """

    checks: Sequence[DependencyCheck]
    rate_limit_storage: Storage | None
    close: Callable[[], Awaitable[None]]
    redis: Redis | None = None
