"""Redis: the settings and the factory behind ``create_redis_client``.

This is the one module that creates a Redis client. Everything else takes the
:class:`RedisPort` that :func:`create_redis_client` returns.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Protocol

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from redis.asyncio import BlockingConnectionPool, Redis
from redis.asyncio.retry import Retry
from redis.backoff import NoBackoff

from core.dependency import DependencyClosedError

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

    # The name is its own: `Settings` inherits every store's settings, and a validator with
    # the name of another store's would replace it without a word.
    @field_validator("redis_url")
    @classmethod
    def _check_redis_url(cls, value: str) -> str:
        """Refuse a URL the client cannot read.

        A port that is not a number, an unparsable host and a query option of the wrong
        type fail when the pool is built, with a message that quotes the part that was
        wrong. Building the pool here, which never connects, stops the boot at the
        settings, where an error names the variable and never its value.

        Args:
            value: The raw setting.

        Returns:
            The setting, unchanged.

        Raises:
            ValueError: With a fixed message, whatever the pool raised.
        """
        try:
            BlockingConnectionPool.from_url(value)
        except Exception:
            raise ValueError("must be a valid redis:// or rediss:// URL") from None
        return value


class RedisConfig(Protocol):
    """What ``create_redis_client`` reads of the validated settings."""

    redis_url: str


@dataclass(frozen=True)
class RedisClientOptions:
    """Settings that tests and unusual deployments may change.

    Attributes:
        connect_timeout_seconds: How long a connection attempt may take.
        socket_timeout_seconds: How long a connected socket may stay silent.
        max_connections: How many connections the pool opens at most.
        pool_wait_seconds: How long a command waits for a free connection when all are in
            use, before it fails as an unavailable store. It equals the bound the rate
            limiter puts on a call, so a burst larger than the pool queues inside that
            bound and a command that outwaits it is answered 503 like a silent server.
    """

    connect_timeout_seconds: float = 2.0
    socket_timeout_seconds: float = 2.0
    max_connections: int = 100
    pool_wait_seconds: float = 1.0


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
    ``close`` the probe fails with a ``ConnectionError``. The pool blocks instead of
    failing when every connection is in use: a burst larger than ``max_connections``
    queues for up to ``pool_wait_seconds``, so a request is counted and answered 429
    rather than refused only because of how many others arrived with it.

    Args:
        config: The validated settings.
        options: Timeouts, for tests.

    Returns:
        The Redis port.
    """
    chosen = options or RedisClientOptions()
    pool = BlockingConnectionPool.from_url(
        config.redis_url,
        max_connections=chosen.max_connections,
        timeout=chosen.pool_wait_seconds,
        socket_connect_timeout=chosen.connect_timeout_seconds,
        socket_timeout=chosen.socket_timeout_seconds,
        retry=Retry(NoBackoff(), 0),
    )
    client = Redis.from_pool(pool)
    closed = False

    async def probe() -> None:
        if closed:
            raise DependencyClosedError("redis: the client is closed")
        if not await client.ping():
            raise ConnectionError("redis: unexpected reply to PING")

    async def close() -> None:
        nonlocal closed
        if closed:
            return
        closed = True
        await client.aclose()

    return RedisPort(name="redis", client=client, probe=probe, close=close)
