import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from types import SimpleNamespace

import pytest
from db_support import Probe, database_with_probe
from local_target import require_local_url
from loguru import logger
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession

from core.bounded import bounded
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


def test_a_nested_run_is_refused_at_once_and_the_runner_stays_usable() -> None:
    async def body(database: DatabasePort, probe: Probe) -> None:
        async def outer(session: object) -> None:
            async def inner(_session: object) -> None:
                return None

            await database.transactions.run(inner)

        with pytest.raises(RuntimeError, match="pass the session down"):
            await database.transactions.run(outer)

        await database.transactions.run(lambda session: probe.insert(session, "after-nested"))
        assert await _read(database, probe, "after-nested")

    _scenario(body)


def test_a_nested_run_on_a_row_the_outer_wrote_is_refused_and_the_outer_rolls_back() -> None:
    """Reproduces the self-deadlock: the inner insert would wait for the outer's own row."""

    async def body(database: DatabasePort, probe: Probe) -> None:
        async def outer(session: object) -> None:
            await probe.insert(session, "self-deadlock")  # type: ignore[arg-type]
            await database.transactions.run(
                lambda inner: probe.insert(inner, "self-deadlock")  # type: ignore[arg-type]
            )

        with pytest.raises(RuntimeError, match="pass the session down"):
            await asyncio.wait_for(database.transactions.run(outer), timeout=5)

        assert not await _read(database, probe, "self-deadlock")

    _scenario(body)


def test_the_outer_transaction_commits_when_it_catches_the_refusal_of_a_nested_run() -> None:
    async def body(database: DatabasePort, probe: Probe) -> None:
        async def outer(session: object) -> None:
            await probe.insert(session, "outer-survives")  # type: ignore[arg-type]

            async def inner(_session: object) -> None:
                return None

            with pytest.raises(RuntimeError):
                await database.transactions.run(inner)

        await database.transactions.run(outer)

        assert await _read(database, probe, "outer-survives")

    _scenario(body)


def test_twelve_concurrent_nested_calls_are_each_refused_and_the_pool_still_serves() -> None:
    """Reproduces the exhausted pool: ten connections, twelve requests that each nest."""

    async def body(database: DatabasePort, probe: Probe) -> None:
        async def nested() -> BaseException | None:
            async def outer(_session: object) -> None:
                async def inner(_inner_session: object) -> None:
                    return None

                await database.transactions.run(inner)

            try:
                await database.transactions.run(outer)
            except RuntimeError as error:
                return error
            return None

        started = time.monotonic()
        outcomes = await asyncio.gather(*(nested() for _ in range(12)))

        assert time.monotonic() - started < 2
        assert all("pass the session down" in str(outcome) for outcome in outcomes)
        await database.transactions.run(lambda session: probe.insert(session, "after-twelve"))
        assert await _read(database, probe, "after-twelve")

    _scenario(body)


def test_a_task_started_inside_a_run_that_runs_after_it_ended_opens_its_own() -> None:
    async def body(database: DatabasePort, probe: Probe) -> None:
        async def later() -> None:
            await asyncio.sleep(0.05)
            await database.transactions.run(lambda session: probe.insert(session, "task-after"))

        tasks: list[asyncio.Task[None]] = []

        async def work(_session: AsyncSession) -> None:
            tasks.append(asyncio.create_task(later()))

        await database.transactions.run(work)
        await tasks[0]

        assert await _read(database, probe, "task-after")

    _scenario(body)


def test_a_task_started_inside_a_run_and_running_while_it_is_open_is_refused() -> None:
    async def body(database: DatabasePort, _probe: Probe) -> None:
        tasks: list[asyncio.Task[None]] = []

        async def nested() -> None:
            await database.transactions.run(lambda _session: asyncio.sleep(0))

        async def work(_session: AsyncSession) -> None:
            tasks.append(asyncio.create_task(nested()))
            await asyncio.sleep(0.05)

        await database.transactions.run(work)

        with pytest.raises(RuntimeError, match="called inside a transaction"):
            await tasks[0]

    _scenario(body)


def test_a_connection_killed_inside_a_run_is_an_outage_and_the_next_run_works() -> None:
    async def body(database: DatabasePort, probe: Probe) -> None:
        marker = f"pg_sleep_kill_{int(time.monotonic() * 1000)}"

        async def sleeper(session: AsyncSession) -> None:
            await session.execute(text(f"select pg_sleep(10) as {marker}"))

        running = asyncio.ensure_future(database.transactions.run(sleeper))
        await asyncio.sleep(0.3)
        async with database.session_factory() as session:
            await session.execute(
                text(
                    "select pg_terminate_backend(pid) from pg_stat_activity "
                    f"where query like '%{marker}%' and pid <> pg_backend_pid()"
                )
            )

        with pytest.raises(Exception) as raised:
            await running

        assert is_dependency_outage(raised.value)
        assert "SQLSTATE 57P01" in format_failure(raised.value)
        await database.transactions.run(lambda session: probe.insert(session, "after-kill"))
        assert await _read(database, probe, "after-kill")

    _scenario(body)


class _Proxy:
    """A TCP proxy in front of the database that can go silent, as a paused server does."""

    def __init__(self, host: str, port: int) -> None:
        self._target = (host, port)
        self.silent = False
        self._server: asyncio.Server | None = None

    async def start(self) -> int:
        self._server = await asyncio.start_server(self._serve, "127.0.0.1", 0)
        return self._server.sockets[0].getsockname()[1]

    def stop(self) -> None:
        if self._server is not None:
            self._server.close()

    async def _pump(self, source: asyncio.StreamReader, sink: asyncio.StreamWriter) -> None:
        while data := await source.read(65536):
            while self.silent:
                await asyncio.sleep(0.05)
            sink.write(data)
            await sink.drain()

    async def _serve(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        while self.silent:
            await asyncio.sleep(0.05)
        upstream_reader, upstream_writer = await asyncio.open_connection(*self._target)
        await asyncio.gather(
            self._pump(reader, upstream_writer),
            self._pump(upstream_reader, writer),
            return_exceptions=True,
        )


def test_a_silent_server_answers_within_the_bound_and_the_abandoned_probe_frees_its_slot() -> None:
    async def run() -> None:
        url = make_url(require_local_url("TEST_DATABASE_URL"))
        proxy = _Proxy(url.host or "127.0.0.1", url.port or 5432)
        port = await proxy.start()
        proxied = url.set(host="127.0.0.1", port=port).render_as_string(hide_password=False)
        database = create_database(SimpleNamespace(database_url=proxied))
        pool = database.session_factory.kw["bind"].pool
        try:
            await database.probe()
            proxy.silent = True

            started = time.monotonic()
            with pytest.raises(TimeoutError):
                await bounded(database.probe(), 1.0, "postgres")
            assert time.monotonic() - started < 1.5

            deadline = time.monotonic() + 15
            while pool.checkedout() > 0 and time.monotonic() < deadline:
                await asyncio.sleep(0.1)
            assert pool.checkedout() == 0

            proxy.silent = False
            await database.probe()
        finally:
            proxy.silent = False
            await database.close()
            proxy.stop()

    asyncio.run(run())


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
