"""The settings of the infrastructure: the connection of Redis."""

from redis_client.client import RedisSettings


class InfraSettings(RedisSettings):
    """The connection settings of the infrastructure, required and validated at boot.

    ``core.config.Settings`` extends this, so a missing or malformed setting stops the
    boot naming the variable and never its value.
    """
