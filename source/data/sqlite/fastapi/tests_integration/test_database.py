import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path
from types import SimpleNamespace

import pytest
from db_support import database_file, exists, insert
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependency import is_dependency_outage
from core.failure import format_failure
from db.database import DatabaseOptions, create_database
from db.session_end import TRANSACTION_ENDED_TEXT, TransactionEndedError
from db.types import DatabasePort


def _scenario(
    body: Callable[[DatabasePort], Awaitable[None]], options: DatabaseOptions | None = None
) -> None:
    """Run a test body against a database of its own, and close it after."""

    async def run() -> None:
        with database_file() as path:
            database = create_database(SimpleNamespace(database_url=str(path)), options)
            try:
                await body(database)
            finally:
                await database.close()

    asyncio.run(run())


async def _read(database: DatabasePort, id_: str) -> bool:
    async with database.session_factory() as session:
        return await exists(session, id_)


def test_the_probe_answers() -> None:
    async def body(database: DatabasePort) -> None:
        await database.probe()

    _scenario(body)


def test_a_transaction_commits_when_the_work_returns() -> None:
    async def body(database: DatabasePort) -> None:
        async def work(session: object) -> None:
            await insert(session, "committed")  # type: ignore[arg-type]

        await database.transactions.run(work)

        assert await _read(database, "committed")

    _scenario(body)


def test_a_transaction_rolls_back_when_the_work_raises_and_the_error_comes_out() -> None:
    async def body(database: DatabasePort) -> None:
        async def work(session: object) -> None:
            await insert(session, "rolled-back")  # type: ignore[arg-type]
            raise ValueError("boom")

        with pytest.raises(ValueError, match="boom"):
            await database.transactions.run(work)

        assert not await _read(database, "rolled-back")

    _scenario(body)


def test_a_write_sees_its_own_transaction_and_is_hidden_from_outside_until_commit() -> None:
    async def body(database: DatabasePort) -> None:
        async def work(session: object) -> None:
            await insert(session, "inside")  # type: ignore[arg-type]
            assert await exists(session, "inside")  # type: ignore[arg-type]
            assert not await _read(database, "inside")

        await database.transactions.run(work)

        assert await _read(database, "inside")

    _scenario(body)


def test_two_concurrent_runs_are_serialised() -> None:
    async def body(database: DatabasePort) -> None:
        order: list[str] = []

        async def first(session: object) -> None:
            order.append("first:start")
            await insert(session, "serial-1")  # type: ignore[arg-type]
            await asyncio.sleep(0.1)
            order.append("first:end")

        async def second(session: object) -> None:
            order.append("second:start")
            await insert(session, "serial-2")  # type: ignore[arg-type]
            order.append("second:end")

        await asyncio.gather(database.transactions.run(first), database.transactions.run(second))

        assert order == ["first:start", "first:end", "second:start", "second:end"]

    _scenario(body)


def test_a_nested_run_is_refused_at_once_and_the_runner_stays_usable() -> None:
    async def body(database: DatabasePort) -> None:
        async def outer(session: object) -> None:
            async def inner(_session: object) -> None:
                return None

            await database.transactions.run(inner)

        with pytest.raises(RuntimeError, match="pass the session down"):
            await database.transactions.run(outer)

        async def after(session: object) -> None:
            await insert(session, "after-nested")  # type: ignore[arg-type]

        await database.transactions.run(after)
        assert await _read(database, "after-nested")

    _scenario(body)


def test_a_run_that_outwaits_the_bound_fails_as_a_busy_store_and_the_runner_stays_usable() -> None:
    async def body(database: DatabasePort) -> None:
        async def hold(_session: object) -> None:
            await asyncio.sleep(0.8)

        async def nothing(_session: object) -> None:
            return None

        holder = asyncio.ensure_future(database.transactions.run(hold))
        await asyncio.sleep(0.05)

        with pytest.raises(Exception) as raised:
            await database.transactions.run(nothing)
        await holder

        assert is_dependency_outage(raised.value)

        async def after(session: object) -> None:
            await insert(session, "after-busy")  # type: ignore[arg-type]

        await database.transactions.run(after)
        assert await _read(database, "after-busy")

    _scenario(body, DatabaseOptions(write_wait_seconds=0.3))


async def _kept_session(database: DatabasePort) -> AsyncSession:
    """Open a transaction, let it commit, and give back the session the work kept."""
    kept: list[AsyncSession] = []

    async def work(session: AsyncSession) -> None:
        kept.append(session)

    await database.transactions.run(work)
    return kept[0]


def test_a_session_used_after_the_commit_raises_and_the_next_write_does_not_wait() -> None:
    """Reproduces the stopped writer: one kept session used to block every write for good."""

    async def body(database: DatabasePort) -> None:
        session = await _kept_session(database)

        with pytest.raises(TransactionEndedError) as raised:
            await session.execute(text("select 1"))

        assert str(raised.value) == TRANSACTION_ENDED_TEXT
        assert not is_dependency_outage(raised.value)
        assert TRANSACTION_ENDED_TEXT in format_failure(raised.value)

        async def next_write(next_session: AsyncSession) -> None:
            await insert(next_session, "after-stale")

        await database.transactions.run(next_write)
        assert await _read(database, "after-stale")

    _scenario(body, DatabaseOptions(write_wait_seconds=0.3))


def test_a_session_used_after_the_rollback_raises_and_writes_nothing() -> None:
    async def body(database: DatabasePort) -> None:
        kept: list[AsyncSession] = []

        async def work(session: AsyncSession) -> None:
            kept.append(session)
            raise ValueError("boom")

        with pytest.raises(ValueError, match="boom"):
            await database.transactions.run(work)

        with pytest.raises(TransactionEndedError):
            await insert(kept[0], "after-rollback")
        with pytest.raises(TransactionEndedError):
            await kept[0].commit()

        assert not await _read(database, "after-rollback")

    _scenario(body, DatabaseOptions(write_wait_seconds=0.3))


def test_a_task_still_running_when_the_work_ends_gets_the_same_error() -> None:
    async def body(database: DatabasePort) -> None:
        tasks: list[asyncio.Task[None]] = []

        async def later(session: AsyncSession) -> None:
            await asyncio.sleep(0.05)
            await insert(session, "late-task")

        async def work(session: AsyncSession) -> None:
            tasks.append(asyncio.create_task(later(session)))

        await database.transactions.run(work)

        with pytest.raises(TransactionEndedError):
            await tasks[0]
        assert not await _read(database, "late-task")

    _scenario(body, DatabaseOptions(write_wait_seconds=0.3))


def test_a_task_started_inside_a_run_that_runs_after_it_ended_opens_its_own() -> None:
    async def body(database: DatabasePort) -> None:
        tasks: list[asyncio.Task[None]] = []

        async def own(session: AsyncSession) -> None:
            await insert(session, "own-after")

        async def later() -> None:
            await asyncio.sleep(0.05)
            await database.transactions.run(own)

        async def work(_session: AsyncSession) -> None:
            tasks.append(asyncio.create_task(later()))

        await database.transactions.run(work)
        await tasks[0]

        assert await _read(database, "own-after")

    _scenario(body)


def test_a_kept_driver_connection_cannot_join_the_next_transaction() -> None:
    """Every transaction shares one writer, so a kept connection would write into the next."""

    async def body(database: DatabasePort) -> None:
        kept: dict[str, object] = {}

        async def work(session: AsyncSession) -> None:
            connection = await session.connection()
            raw = await connection.get_raw_connection()
            kept.update(
                sync=session.sync_session,
                connection=connection,
                driver=raw.driver_connection,
            )

        await database.transactions.run(work)

        with pytest.raises(TransactionEndedError):
            kept["sync"].execute(text("select 1"))  # type: ignore[attr-defined]
        with pytest.raises(TransactionEndedError):
            await kept["connection"].execute(text("select 1"))  # type: ignore[attr-defined]

        async def other(session: AsyncSession) -> None:
            await insert(session, "other")
            with pytest.raises(TransactionEndedError):
                await kept["driver"].execute(  # type: ignore[attr-defined]
                    "insert into probe (id) values ('from-driver')"
                )

        await database.transactions.run(other)

        assert await _read(database, "other")
        assert not await _read(database, "from-driver")

    _scenario(body, DatabaseOptions(write_wait_seconds=0.3))


def test_a_factory_session_ends_with_its_block() -> None:
    async def body(database: DatabasePort) -> None:
        async with database.session_factory() as session:
            await session.execute(text("select 1"))

        with pytest.raises(TransactionEndedError):
            await session.execute(text("select 1"))
        await session.close()

    _scenario(body)


def test_a_write_through_the_reading_session_is_refused() -> None:
    async def body(database: DatabasePort) -> None:
        async with database.session_factory() as session:
            with pytest.raises(Exception, match="readonly"):
                await insert(session, "outside")

    _scenario(body)


def test_a_failed_statement_prints_no_bound_value() -> None:
    from core.failure import format_failure

    async def body(database: DatabasePort) -> None:
        async def work(session: object) -> None:
            await session.execute(  # type: ignore[attr-defined]
                text("insert into missing_table values (:v)"), {"v": "SECRET-TOKEN-123"}
            )

        with pytest.raises(Exception) as raised:
            await database.transactions.run(work)

        logged = format_failure(raised.value)
        assert "no such table" in logged
        assert "SECRET-TOKEN-123" not in logged
        assert "hidden" in logged

    _scenario(body)


def test_the_probe_and_the_runner_fail_once_the_database_is_closed() -> None:
    async def body(database: DatabasePort) -> None:
        await database.close()
        await database.close()

        for call in (database.probe, lambda: database.transactions.run(_noop)):
            with pytest.raises(ConnectionError):
                await call()

    async def _noop(_session: object) -> None:
        return None

    _scenario(body)


def test_a_wrong_path_creates_no_file(tmp_path: Path) -> None:
    wrong = tmp_path / "missing.db"

    async def run() -> None:
        database = create_database(SimpleNamespace(database_url=str(wrong)))
        try:
            with pytest.raises(Exception) as raised:
                await database.probe()
            assert is_dependency_outage(raised.value)
        finally:
            await database.close()

    asyncio.run(run())

    assert not wrong.exists()
