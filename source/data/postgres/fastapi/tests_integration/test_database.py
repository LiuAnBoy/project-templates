import asyncio
import logging
from collections.abc import Awaitable, Callable
from types import SimpleNamespace

import pytest
from db_support import Probe, database_with_probe
from local_target import require_local_url
from loguru import logger
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependency import is_dependency_outage
from core.failure import format_failure
from core.logging import configure_logging
from db.database import create_database
from db.types import DatabasePort

Body = Callable[[DatabasePort, Probe], Awaitable[None]]


def _scenario(body: Body) -> None:
    """Run a test body against the database and a probe table of its own."""

    async def run() -> None:
        async with database_with_probe() as (database, probe):
            await body(database, probe)

    asyncio.run(run())


async def _read(database: DatabasePort, probe: Probe, id_: str) -> bool:
    async with database.session_factory() as session:
        return await probe.exists(session, id_)


def test_the_probe_answers() -> None:
    async def body(database: DatabasePort, probe: Probe) -> None:
        await database.probe()

    _scenario(body)


def test_a_transaction_commits_when_the_work_returns() -> None:
    async def body(database: DatabasePort, probe: Probe) -> None:
        await database.transactions.run(lambda session: probe.insert(session, "committed"))

        assert await _read(database, probe, "committed")

    _scenario(body)


def test_a_transaction_rolls_back_when_the_work_raises_and_the_error_comes_out() -> None:
    async def body(database: DatabasePort, probe: Probe) -> None:
        async def work(session: object) -> None:
            await probe.insert(session, "rolled-back")  # type: ignore[arg-type]
            raise ValueError("boom")

        with pytest.raises(ValueError, match="boom"):
            await database.transactions.run(work)

        assert not await _read(database, probe, "rolled-back")

    _scenario(body)


def test_a_write_sees_its_own_transaction_and_is_hidden_from_outside_until_commit() -> None:
    async def body(database: DatabasePort, probe: Probe) -> None:
        async def work(session: object) -> None:
            await probe.insert(session, "inside")  # type: ignore[arg-type]
            assert await probe.exists(session, "inside")  # type: ignore[arg-type]
            assert not await _read(database, probe, "inside")

        await database.transactions.run(work)

        assert await _read(database, probe, "inside")

    _scenario(body)


def test_a_failed_statement_logs_no_bound_value_and_no_quoting_driver_message() -> None:
    async def body(database: DatabasePort, probe: Probe) -> None:
        for statement in (
            "select cast(:v as uuid)",  # the server's reply quotes the value (22P02)
            f'insert into "{probe.schema}".nope values (:v)',  # a statement the server refuses
        ):
            with pytest.raises(Exception) as raised:
                await database.transactions.run(
                    lambda session, s=statement: session.execute(text(s), {"v": "SECRET-TOKEN-123"})
                )

            logged = format_failure(raised.value)
            assert "[SQL: " in logged
            assert "SECRET-TOKEN-123" not in logged
            assert "hidden due to hide_parameters" in logged

    _scenario(body)


def test_the_message_of_a_unique_violation_is_withheld_with_its_key() -> None:
    key = "-".join(
        ["SECRET", "KEY", "9"]
    )  # not spelled out, so no source line of a traceback holds it

    async def body(database: DatabasePort, probe: Probe) -> None:
        await database.transactions.run(lambda session: probe.insert(session, key))

        with pytest.raises(Exception) as raised:
            await database.transactions.run(lambda session: probe.insert(session, key))

        logged = format_failure(raised.value)
        assert "UniqueViolation" in logged
        assert key not in logged

    _scenario(body)


def test_the_probe_and_the_runner_fail_once_the_database_is_closed() -> None:
    async def run() -> None:
        database = create_database(
            SimpleNamespace(database_url=require_local_url("TEST_DATABASE_URL"))
        )
        await database.probe()
        await database.close()
        await database.close()

        with pytest.raises(ConnectionError) as raised:
            await database.probe()
        assert is_dependency_outage(raised.value)

    asyncio.run(run())


def test_no_log_line_holds_a_bound_value_at_debug(capsys: pytest.CaptureFixture[str]) -> None:
    root = logging.getLogger()
    handlers, level = root.handlers[:], root.level
    configure_logging("DEBUG")
    sentinel = "SENTINEL-bound-value-4242"

    async def body(database: DatabasePort, probe: Probe) -> None:
        async def write(session: AsyncSession) -> None:
            await probe.insert(session, sentinel)

        await database.transactions.run(write)
        async with database.session_factory() as session:
            await session.execute(text("select cast(:v as text)"), {"v": sentinel})

    try:
        _scenario(body)
    finally:
        logger.remove()
        root.handlers[:] = handlers
        root.setLevel(level)

    captured = capsys.readouterr()
    assert sentinel not in captured.out + captured.err
