"""What the process depends on, as ``create_infra`` hands it to ``create_app``."""

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass

from limits.aio.storage import Storage
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.dependency_checks import DependencyCheck
from db.types import TransactionRunner


@dataclass(frozen=True)
class Infra:
    """The checks, the limiter storage, the close function, the database and the Redis client.

    Attributes:
        checks: Run by the health route and, before the server listens, by the lifespan.
        rate_limit_storage: The shared storage of the rate limit; None keeps the
            counts in process memory.
        close: Releases what ``create_infra`` opened; awaited when the app shuts down.
        session_factory: Opens a session for reads. None only in the stub that the
            ordinary tests install in place of the seam.
        transactions: The only way to open a transaction. None only in that stub.
        redis: The Redis client. None only in that stub.
    """

    checks: Sequence[DependencyCheck]
    rate_limit_storage: Storage | None
    close: Callable[[], Awaitable[None]]
    session_factory: async_sessionmaker[AsyncSession] | None = None
    transactions: TransactionRunner | None = None
    redis: Redis | None = None
