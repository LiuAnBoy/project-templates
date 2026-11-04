import asyncio
import logging
import sqlite3
from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace

import pytest
from loguru import logger
from sqlalchemy import text

from core.logging import configure_logging
from db.database import create_database

SENTINEL = "SENTINEL-bound-value-4242"


@pytest.fixture
def debug_log(capsys: pytest.CaptureFixture[str]) -> Iterator[pytest.CaptureFixture[str]]:
    """The server's own logging at DEBUG, writing to the captured stdout."""
    root = logging.getLogger()
    handlers, level = root.handlers[:], root.level
    configure_logging("DEBUG")
    yield capsys
    logger.remove()
    root.handlers[:] = handlers
    root.setLevel(level)


def test_no_log_line_holds_a_bound_value_at_debug(
    debug_log: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    path = tmp_path / "log.db"
    connection = sqlite3.connect(path)
    connection.execute("create table t (v text)")
    connection.commit()
    connection.close()

    async def run() -> None:
        database = create_database(SimpleNamespace(database_url=str(path)))
        try:

            async def write(session: object) -> None:
                await session.execute(  # type: ignore[attr-defined]
                    text("insert into t values (:v)"), {"v": SENTINEL}
                )

            await database.transactions.run(write)
            async with database.session_factory() as session:
                await session.execute(text("select * from t where v = :v"), {"v": SENTINEL})
        finally:
            await database.close()

    asyncio.run(run())

    captured = debug_log.readouterr()
    assert SENTINEL not in captured.out + captured.err
