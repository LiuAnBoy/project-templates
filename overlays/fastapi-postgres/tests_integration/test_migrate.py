import asyncio
import io
import secrets
import shutil
from pathlib import Path
from urllib.parse import quote

import pytest
from alembic.config import Config
from local_target import require_local_url
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from db.database import engine_url
from db.migrate import ROOT, describe_migrate_failure, run_migrate, run_status

CREATE = """
def upgrade() -> None:
    op.create_table("probe", sa.Column("id", sa.String(), primary_key=True))
"""


def _config(root: Path) -> Config:
    """An Alembic folder holding one revision, with the project's own env.py."""
    folder = root / "alembic"
    (folder / "versions").mkdir(parents=True)
    for name in ("env.py", "script.py.mako"):
        shutil.copy(ROOT / "alembic" / name, folder / name)
    (folder / "versions" / "rev0.py").write_text(
        "import sqlalchemy as sa\nfrom alembic import op\n\n"
        'revision = "rev0"\ndown_revision = None\nbranch_labels = None\ndepends_on = None\n'
        + CREATE
    )
    config = Config()
    config.set_main_option("script_location", str(folder))
    return config


async def _admin(sql: str) -> None:
    engine = create_async_engine(engine_url(require_local_url("TEST_DATABASE_URL")))
    try:
        async with engine.begin() as connection:
            await connection.execute(text(sql))
    finally:
        await engine.dispose()


def test_status_lists_a_pending_revision_and_is_empty_at_head(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    schema = f"it_{secrets.token_hex(6)}"
    base = require_local_url("TEST_DATABASE_URL")
    # Everything the commands create (alembic_version, the table) lands in the throwaway schema.
    options = quote(f"-csearch_path={schema}")
    monkeypatch.setenv("DATABASE_URL", f"{base}{'&' if '?' in base else '?'}options={options}")
    config = _config(tmp_path)

    async def scenario() -> tuple[str, str, str]:
        await _admin(f'create schema "{schema}"')
        try:
            pending, applied, after = io.StringIO(), io.StringIO(), io.StringIO()
            await run_status(pending, config)
            await run_migrate(applied, config)
            await run_status(after, config)
            return pending.getvalue(), applied.getvalue(), after.getvalue()
        finally:
            await _admin(f'drop schema "{schema}" cascade')

    pending, applied, after = asyncio.run(scenario())

    assert "Pending migrations (1):" in pending and "rev0" in pending
    assert "Recorded in alembic_version:" in applied
    assert "No pending migrations." in after


def test_a_missing_database_prints_no_host_user_or_database_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    base = require_local_url("TEST_DATABASE_URL")
    monkeypatch.setenv("DATABASE_URL", base.rsplit("/", 1)[0] + "/secret-missing-db")

    for run in (run_migrate, run_status):
        with pytest.raises(Exception) as raised:
            asyncio.run(run(io.StringIO()))

        text_ = describe_migrate_failure(raised.value)
        assert text_.startswith("Cannot reach or open the database")
        assert "secret-missing-db" not in text_
        assert "localhost" not in text_ and "127.0.0.1" not in text_
