import asyncio

import pytest
from redis_support import delete_by_prefix, target

from core.config import Settings
from infra.infra import create_infra


def test_the_real_seam_hands_out_the_redis_client_and_one_round_trip_completes() -> None:
    async def run() -> None:
        where = target()
        infra = create_infra(Settings(_env_file=None, redis_url=where.url))
        assert infra.redis is not None
        key = f"{where.prefix}:seam"
        try:
            await infra.redis.set(key, "value", ex=30)

            assert await infra.redis.get(key) == b"value"
        finally:
            await delete_by_prefix(infra.redis, where.prefix)
            await infra.close()

    asyncio.run(run())


def test_the_seam_has_the_limiter_storage_and_one_check_that_fails_once_the_infra_is_closed() -> (
    None
):
    async def run() -> None:
        where = target()
        infra = create_infra(Settings(_env_file=None, redis_url=where.url))
        other = create_infra(Settings(_env_file=None, redis_url=where.url))
        try:
            assert infra.rate_limit_storage is not None
            assert [check.name for check in infra.checks] == ["redis"]
            await infra.checks[0].run()
            await other.close()
            with pytest.raises(ConnectionError):
                await other.checks[0].run()
        finally:
            await infra.close()

    asyncio.run(run())
