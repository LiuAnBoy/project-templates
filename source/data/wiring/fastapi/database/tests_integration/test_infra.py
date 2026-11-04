import asyncio

import pytest
from db_support import create_probe, database_url, drop_probe

from core.config import Settings
from infra.infra import create_infra


def test_the_real_seam_hands_out_the_database_and_one_transaction_through_it_commits() -> None:
    async def run() -> None:
        with database_url() as url:
            infra = create_infra(Settings(_env_file=None, database_url=url))
            assert infra.transactions is not None and infra.session_factory is not None
            probe = await create_probe(infra.transactions)
            try:
                await infra.transactions.run(lambda session: probe.insert(session, "seam"))

                async with infra.session_factory() as session:
                    assert await probe.exists(session, "seam")
            finally:
                await drop_probe(infra.transactions, probe)
                await infra.close()

    asyncio.run(run())


def test_the_seam_has_one_check_for_the_store_and_it_fails_once_the_infra_is_closed() -> None:
    async def run() -> None:
        with database_url() as url:
            infra = create_infra(Settings(_env_file=None, database_url=url))
            other = create_infra(Settings(_env_file=None, database_url=url))
            try:
                assert len(infra.checks) == 1
                assert infra.rate_limit_storage is None
                for check in infra.checks:
                    await check.run()
                await other.close()
                for check in other.checks:
                    with pytest.raises(ConnectionError):
                        await check.run()
            finally:
                await infra.close()

    asyncio.run(run())
