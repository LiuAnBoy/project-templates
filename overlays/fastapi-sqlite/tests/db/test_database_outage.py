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
