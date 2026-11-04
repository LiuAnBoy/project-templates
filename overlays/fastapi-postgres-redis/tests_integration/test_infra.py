import asyncio

import pytest
from db_support import create_probe, database_url, drop_probe
from redis_support import delete_by_prefix, target

from core.config import Settings
from infra.infra import create_infra


def test_the_real_seam_hands_out_the_database_and_the_redis_client() -> None:
    async def run() -> None:
        where = target()
        with database_url() as url:
            infra = create_infra(Settings(_env_file=None, database_url=url, redis_url=where.url))
            assert infra.transactions is not None and infra.session_factory is not None
            assert infra.redis is not None
            probe = await create_probe(infra.transactions)
            key = f"{where.prefix}:seam"
            try:
                await infra.transactions.run(lambda session: probe.insert(session, "seam"))
                async with infra.session_factory() as session:
                    assert await probe.exists(session, "seam")

                await infra.redis.set(key, "value", ex=30)
                assert await infra.redis.get(key) == b"value"
            finally:
                await delete_by_prefix(infra.redis, where.prefix)
                await drop_probe(infra.transactions, probe)
                await infra.close()

    asyncio.run(run())


def test_the_seam_has_the_limiter_storage_and_one_check_per_store_that_fail_once_closed() -> None:
    async def run() -> None:
        where = target()
        with database_url() as url:
            config = Settings(_env_file=None, database_url=url, redis_url=where.url)
            infra = create_infra(config)
            other = create_infra(config)
            try:
                assert infra.rate_limit_storage is not None
                assert len(infra.checks) == 2
                assert infra.checks[1].name == "redis"
                for check in infra.checks:
                    await check.run()
                await other.close()
                for check in other.checks:
                    with pytest.raises(ConnectionError):
                        await check.run()
            finally:
                await infra.close()

    asyncio.run(run())
