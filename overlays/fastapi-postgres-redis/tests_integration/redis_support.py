"""A prefix of its own for the store tests, and the removal of what they wrote."""

import secrets
from dataclasses import dataclass

from local_target import require_local_url
from redis.asyncio import Redis


@dataclass(frozen=True)
class Target:
    """A Redis for a store test to run against, and the key prefix that test owns.

    Attributes:
        url: The value for ``REDIS_URL``.
        prefix: A random service prefix; every key a test writes starts with it.
    """

    url: str
    prefix: str


def target() -> Target:
    """Name the Redis the store tests run against: ``TEST_REDIS_URL``, which must be local.

    A test writes only under a random prefix of its own and removes what it wrote with
    :func:`delete_by_prefix`; it never flushes.

    Returns:
        The target.

    Raises:
        RuntimeError: When ``TEST_REDIS_URL`` is missing or not local.
    """
    return Target(require_local_url("TEST_REDIS_URL"), f"it{secrets.token_hex(6)}")


async def keys_with_prefix(client: Redis, prefix: str) -> list[str]:
    """List the keys under a prefix, with SCAN in batches.

    Args:
        client: A connected client.
        prefix: The test's prefix.

    Returns:
        The keys found.
    """
    return [key.decode() async for key in client.scan_iter(match=f"{prefix}:*", count=200)]


async def delete_by_prefix(client: Redis, prefix: str) -> None:
    """Delete the keys of one test by exact name, never by a flush.

    Args:
        client: A connected client.
        prefix: The test's prefix.
    """
    keys = await keys_with_prefix(client, prefix)
    if keys:
        await client.delete(*keys)
