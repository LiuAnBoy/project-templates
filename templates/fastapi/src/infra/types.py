"""What the process depends on, as ``create_infra`` hands it to ``create_app``."""

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass

from limits.aio.storage import Storage

from core.dependency_checks import DependencyCheck


@dataclass(frozen=True)
class Infra:
    """The checks, the optional limiter storage and the close function.

    Attributes:
        checks: Run by the health route and, before the server listens, by the lifespan.
        rate_limit_storage: The shared storage of the rate limit; None keeps the
            counts in process memory.
        close: Releases what ``create_infra`` opened; awaited when the app shuts down.
    """

    checks: Sequence[DependencyCheck]
    rate_limit_storage: Storage | None
    close: Callable[[], Awaitable[None]]
