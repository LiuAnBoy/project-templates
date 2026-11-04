"""The rate limit's counters in Redis, shared by every instance."""

from limits.aio.storage import RedisStorage, Storage
from redis.asyncio import Redis

from redis_client.client import REDIS_KEY_PREFIX


def create_rate_limit_storage(client: Redis, prefix: str = REDIS_KEY_PREFIX) -> Storage:
    """Build the ``limits`` storage that counts in Redis through the seam's client.

    Every counter lives under ``<prefix>:rate-limit:`` and has a TTL (a fixed window
    sets it with the first hit). The storage shares the client's connection pool, so
    nothing opens a second one. It fails like the client does: ``RateLimitMiddleware``
    runs every call under ``bounded()`` and answers 503 when Redis fails or does not
    answer in time, and never lets a request through uncounted.

    Args:
        client: The Redis client of the seam.
        prefix: The service prefix of the keys; defaults to ``REDIS_KEY_PREFIX``.

    Returns:
        A ``limits`` storage for ``RateLimitMiddleware``.
    """
    return RedisStorage(
        "async+redis://",
        implementation="redispy",
        key_prefix=f"{prefix}:rate-limit",
        connection_pool=client.connection_pool,
    )
