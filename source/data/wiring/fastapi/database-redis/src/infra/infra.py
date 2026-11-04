"""The seam between the application and what it depends on."""

import asyncio

from core.dependency_checks import DependencyCheck
from db.database import create_database
from infra.settings import InfraSettings
from infra.types import Infra
from redis_client.client import create_redis_client
from redis_client.rate_limit import create_rate_limit_storage


def create_infra(config: InfraSettings) -> Infra:
    """Build what the process depends on from its settings.

    ``create_app`` takes the checks, the shared limiter storage and the close function
    from here, and nothing else names a store. Each store is created once, here, and
    connects on first use; the project passes ``session_factory``, ``transactions`` and
    ``redis`` to the services it wires in ``main.py``. The limiter counts in Redis,
    shared by every instance, and a Redis that does not answer fails the request with
    503 and never lets it through uncounted.

    Args:
        config: The validated settings; the stores' settings are on it.

    Returns:
        The checks, the limiter storage, the close function, the session factory, the
        transaction runner and the Redis client.
    """
    database = create_database(config)
    redis = create_redis_client(config)

    async def close() -> None:
        await asyncio.gather(database.close(), redis.close(), return_exceptions=True)

    return Infra(
        checks=(
            DependencyCheck(database.name, database.probe),
            DependencyCheck(redis.name, redis.probe),
        ),
        rate_limit_storage=create_rate_limit_storage(redis.client),
        close=close,
        session_factory=database.session_factory,
        transactions=database.transactions,
        redis=redis.client,
    )
