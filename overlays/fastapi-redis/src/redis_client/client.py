"""Redis: the settings and the factory behind ``create_redis_client``.

This is the one module that creates a Redis client. Everything else takes the
:class:`RedisPort` that :func:`create_redis_client` returns.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Protocol

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from redis.asyncio import Redis
from redis.asyncio.retry import Retry
from redis.backoff import NoBackoff

#: The first segment of every key this template writes itself (the rate limiter's
#: counters). Several services may share one Redis, so change it to the name of the
#: project, and use it for the keys of your own code too (``<service>:<entity>:<id>``).
REDIS_KEY_PREFIX = "app"


class RedisSettings(BaseSettings):
    """The settings of Redis; required, so a missing one stops the boot.

    ``core.config.Settings`` extends this through ``infra.settings``. A validation
    message never repeats the value, which can hold the password.

    Attributes:
        redis_url: A ``redis://`` or ``rediss://`` URL.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
        case_sensitive=False,
        hide_input_in_errors=True,
        validate_by_name=True,
        validate_by_alias=True,
    )

    # The alias names the variable in an error: `REDIS_URL`, not `redis_url`.
    redis_url: str = Field(alias="REDIS_URL", pattern=r"^rediss?://")


class RedisConfig(Protocol):
    """What ``create_redis_client`` reads of the validated settings."""

    redis_url: str


@dataclass(frozen=True)
class RedisClientOptions:
    """Settings that tests and unusual deployments may change.

    Attributes:
        connect_timeout_seconds: How long a connection attempt may take.
        socket_timeout_seconds: How long a connected socket may stay silent.
    """

    connect_timeout_seconds: float = 2.0
    socket_timeout_seconds: float = 2.0


@dataclass(frozen=True)
class RedisPort:
    """What a store factory hands to the seam: the client, a probe and a close.

    Attributes:
        name: The name a dependency check and a log line give this store.
        client: The client; one per process, shared by everything that needs Redis.
        probe: One real round trip; raises when Redis does not answer.
        close: Ends the connections; safe to call twice.
    """

    name: str
    client: Redis
    probe: Callable[[], Awaitable[None]]
    close: Callable[[], Awaitable[None]]


def create_redis_client(
    config: RedisConfig, options: RedisClientOptions | None = None
) -> RedisPort:
    """Create the Redis client, a probe and a close.

    The client connects on first use. It has no offline queue and does not retry, so
    while no connection can be made every command fails at once with a connection
    error that ``is_dependency_outage`` accepts, instead of waiting in memory and
    running late; a silent server ends in a timeout error after
    ``socket_timeout_seconds``. It does not read the environment and assumes nothing
    about where the server is. Its errors carry the host and port: they are logged
    through ``core.failure``, which withholds them, and never printed raw. After
    ``close`` the probe fails with a ``ConnectionError``.

    Args:
        config: The validated settings.
        options: Timeouts, for tests.

    Returns:
        The Redis port.
    """
    chosen = options or RedisClientOptions()
    client = Redis.from_url(
        config.redis_url,
        socket_connect_timeout=chosen.connect_timeout_seconds,
        socket_timeout=chosen.socket_timeout_seconds,
        retry=Retry(NoBackoff(), 0),
    )
    closed = False

    async def probe() -> None:
        if closed:
            raise ConnectionError("redis: the client is closed")
        if not await client.ping():
            raise ConnectionError("redis: unexpected reply to PING")

    async def close() -> None:
        nonlocal closed
        if closed:
            return
        closed = True
        await client.aclose()

    return RedisPort(name="redis", client=client, probe=probe, close=close)
