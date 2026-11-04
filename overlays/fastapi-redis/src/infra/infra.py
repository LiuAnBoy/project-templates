"""The seam between the application and what it depends on."""

from core.dependency_checks import DependencyCheck
from infra.settings import InfraSettings
from infra.types import Infra
from redis_client.client import create_redis_client
from redis_client.rate_limit import create_rate_limit_storage


def create_infra(config: InfraSettings) -> Infra:
    """Build what the process depends on from its settings.

    ``create_app`` takes the checks, the shared limiter storage and the close function
    from here, and nothing else names a store. The client is created once, here, and
    connects on first use; the project takes ``redis`` at ``main.py``. The limiter
    counts in Redis, shared by every instance, and a Redis that does not answer fails
    the request with 503 and never lets it through uncounted.

    Args:
        config: The validated settings; Redis's settings are on it.

    Returns:
        The checks, the limiter storage, the close function and the Redis client.
    """
    redis = create_redis_client(config)
    return Infra(
        checks=(DependencyCheck(redis.name, redis.probe),),
        rate_limit_storage=create_rate_limit_storage(redis.client),
        close=redis.close,
        redis=redis.client,
    )
