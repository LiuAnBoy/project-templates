import asyncio
import sqlite3
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import text

from core.dependency import is_dependency_outage
from core.failure import format_failure
from db.database import DatabaseOptions, create_database


def _config(path: Path) -> SimpleNamespace:
    return SimpleNamespace(database_url=str(path))


def _fails(path: Path, work: str, options: DatabaseOptions | None = None) -> BaseException:
    """Run one thing against a database and return the error it fails with."""

    async def attempt() -> BaseException:
        database = create_database(_config(path), options)
        try:
            if work == "probe":
                await database.probe()
            else:

                async def write(session: object) -> None:
                    await session.execute(text("create table t (i integer)"))  # type: ignore[attr-defined]

                await database.transactions.run(write)
        except Exception as error:
            return error
        finally:
            await database.close()
        raise AssertionError("the call did not fail")

    return asyncio.run(attempt())


def test_a_wrong_path_fails_the_probe_with_an_outage_and_creates_no_file(tmp_path: Path) -> None:
    wrong = tmp_path / "missing" / "app.db"

    error = _fails(wrong, "probe")

    assert is_dependency_outage(error)
    assert str(tmp_path) not in format_failure(error)
    assert not wrong.exists()
    assert not wrong.parent.exists()


def test_a_write_on_a_lock_another_process_holds_fails_as_an_outage(tmp_path: Path) -> None:
    file = tmp_path / "held.db"
    sqlite3.connect(file).close()
    holder = sqlite3.connect(file, isolation_level=None)
    holder.execute("pragma journal_mode = wal")
    holder.execute("begin immediate")

    try:
        error = _fails(file, "write", DatabaseOptions(busy_timeout_ms=50))
    finally:
        holder.close()

    assert is_dependency_outage(error)


def test_the_probe_of_a_closed_database_fails(tmp_path: Path) -> None:
    file = tmp_path / "app.db"
    sqlite3.connect(file).close()

    async def attempt() -> BaseException:
        database = create_database(_config(file))
        await database.probe()
        await database.close()
        await database.close()
        try:
            await database.probe()
        except Exception as error:
            return error
        raise AssertionError("the probe of a closed database did not fail")

    assert is_dependency_outage(asyncio.run(attempt()))


@pytest.mark.parametrize("path", [":memory:", "file:app.db", "sqlite:///app.db"])
def test_a_setting_that_is_not_a_file_path_is_refused(path: str) -> None:
    from pydantic import ValidationError

    from db.database import DatabaseSettings

    with pytest.raises(ValidationError) as raised:
        DatabaseSettings(database_url=path)

    assert path not in str(raised.value)


def test_a_task_started_inside_a_run_that_runs_after_it_ended_opens_its_own(tmp_path: Path) -> None:
    file = tmp_path / "task.db"
    sqlite3.connect(file).close()

    async def run() -> str:
        database = create_database(_config(file))
        tasks: list[asyncio.Task[str]] = []

        async def later() -> str:
            await asyncio.sleep(0.05)

            async def own(_session: object) -> str:
                return "opened"

            return await database.transactions.run(own)

        async def work(_session: object) -> None:
            tasks.append(asyncio.create_task(later()))

        try:
            await database.transactions.run(work)
            return await tasks[0]
        finally:
            await database.close()

    assert asyncio.run(run()) == "opened"


def test_a_task_started_inside_a_run_and_running_while_it_is_open_is_refused(
    tmp_path: Path,
) -> None:
    file = tmp_path / "during.db"
    sqlite3.connect(file).close()

    async def run() -> None:
        database = create_database(_config(file))
        tasks: list[asyncio.Task[None]] = []

        async def nested() -> None:
            await database.transactions.run(lambda _session: asyncio.sleep(0))

        async def work(_session: object) -> None:
            tasks.append(asyncio.create_task(nested()))
            await asyncio.sleep(0.05)

        try:
            await database.transactions.run(work)
            with pytest.raises(RuntimeError, match="called inside a transaction"):
                await tasks[0]
        finally:
            await database.close()

    asyncio.run(run())


def test_the_code_of_an_unopenable_file_is_kept_in_the_log(tmp_path: Path) -> None:
    logged = format_failure(_fails(tmp_path / "missing.db", "probe"))

    assert "[SQLITE_CANTOPEN]" in logged
    assert str(tmp_path) not in logged
