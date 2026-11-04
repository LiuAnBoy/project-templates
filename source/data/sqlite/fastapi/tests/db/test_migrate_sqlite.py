import asyncio
import io
import shutil
import sqlite3
from pathlib import Path

import pytest
from alembic.config import Config

from db.migrate import AHEAD_WARNING, ROOT, migrate_main, run_migrate, run_status

CREATE = """
def upgrade() -> None:
    op.create_table(
        "parent",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("n", sa.Integer()),
    )
    op.create_table(
        "child",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("parent_id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["parent_id"], ["parent.id"], ondelete="CASCADE"),
    )
"""

# What autogenerate writes when a column of a referenced table changes type, in batch mode.
REBUILD = """
def upgrade() -> None:
    with op.batch_alter_table("parent") as batch:
        batch.alter_column("n", type_=sa.String())
"""

# Creates a table, then fails: a revision that breaks halfway.
BROKEN = """
def upgrade() -> None:
    op.create_table("half", sa.Column("id", sa.String(), primary_key=True))
    op.execute("INSERT INTO nowhere VALUES (1)")
"""

FIXED = """
def upgrade() -> None:
    op.create_table("half", sa.Column("id", sa.String(), primary_key=True))
"""

ORPHAN = """
def upgrade() -> None:
    op.execute("INSERT INTO child (id, parent_id) VALUES ('x', 'missing')")
"""


def _config(root: Path, bodies: list[str]) -> Config:
    """An Alembic folder holding one revision per body, with the project's own env.py."""
    folder = root / "alembic"
    (folder / "versions").mkdir(parents=True, exist_ok=True)
    for name in ("env.py", "script.py.mako"):
        shutil.copy(ROOT / "alembic" / name, folder / name)
    for index, body in enumerate(bodies):
        previous = f"rev{index - 1}" if index else None
        (folder / "versions" / f"rev{index}.py").write_text(
            "import sqlalchemy as sa\nfrom alembic import op\n\n"
            f'revision = "rev{index}"\ndown_revision = {previous!r}\n'
            "branch_labels = None\ndepends_on = None\n" + body
        )
    config = Config()
    config.set_main_option("script_location", str(folder))
    return config


@pytest.fixture
def database(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "app.db"
    monkeypatch.setenv("DATABASE_URL", str(path))
    return path


def _migrate(config: Config) -> str:
    out = io.StringIO()
    asyncio.run(run_migrate(out, config))
    return out.getvalue()


def _seed(database: Path, tmp_path: Path) -> None:
    _migrate(_config(tmp_path / "one", [CREATE]))
    connection = sqlite3.connect(database)
    connection.executescript(
        "insert into parent values ('p', 1); insert into child values ('c', 'p');"
    )
    connection.commit()
    connection.close()


def _child_rows(database: Path) -> int:
    connection = sqlite3.connect(database)
    try:
        return connection.execute("select count(*) from child").fetchone()[0]
    finally:
        connection.close()


def test_sqlite_deletes_child_rows_when_a_referenced_table_is_dropped_with_enforcement_on(
    tmp_path: Path,
) -> None:
    """The premise: it is the drop of the rebuilt parent that cascades, when keys are enforced."""
    connection = sqlite3.connect(tmp_path / "premise.db")
    connection.executescript(
        "create table parent (id text primary key);"
        "create table child (id text primary key, parent_id text references parent(id)"
        " on delete cascade);"
        "insert into parent values ('p'); insert into child values ('c', 'p');"
        "pragma foreign_keys = on;"
    )
    connection.execute("drop table parent")

    assert connection.execute("select count(*) from child").fetchone()[0] == 0


def test_the_child_rows_survive_a_batch_rebuild_of_the_parent(
    database: Path, tmp_path: Path
) -> None:
    _seed(database, tmp_path)

    _migrate(_config(tmp_path / "two", [CREATE, REBUILD]))

    assert _child_rows(database) == 1


def test_a_violation_keeps_failing_on_a_rerun_even_with_nothing_pending(
    database: Path, tmp_path: Path
) -> None:
    _seed(database, tmp_path)
    config = _config(tmp_path / "two", [CREATE, ORPHAN])
    with pytest.raises(Exception, match=r"break a foreign key \(1 in child\)"):
        _migrate(config)

    out = io.StringIO()
    with pytest.raises(Exception, match=r"break a foreign key \(1 in child\)"):
        asyncio.run(run_migrate(out, config))
    assert "No pending migrations." in out.getvalue()


def test_a_consistent_database_passes_a_rerun_with_nothing_pending(
    database: Path, tmp_path: Path
) -> None:
    _seed(database, tmp_path)

    assert "No pending migrations." in _migrate(_config(tmp_path / "one", [CREATE]))


def test_status_creates_no_file_and_lists_every_revision_as_pending(
    database: Path, tmp_path: Path
) -> None:
    out = io.StringIO()

    asyncio.run(run_status(out, _config(tmp_path / "one", [CREATE])))

    assert "rev0" in out.getvalue()
    assert not database.exists()


def _tables(database: Path) -> set[str]:
    connection = sqlite3.connect(database)
    try:
        rows = connection.execute("select name from sqlite_master where type = 'table'").fetchall()
    finally:
        connection.close()
    return {row[0] for row in rows}


def test_a_revision_that_fails_halfway_leaves_nothing_and_a_corrected_rerun_succeeds(
    database: Path, tmp_path: Path
) -> None:
    with pytest.raises(Exception, match="no such table: nowhere"):
        _migrate(_config(tmp_path / "broken", [BROKEN]))

    assert _tables(database) <= {"sqlite_sequence"}

    assert "rev0" in _migrate(_config(tmp_path / "fixed", [FIXED]))
    assert {"half", "alembic_version"} <= _tables(database)


def _ahead(database: Path, tmp_path: Path) -> Config:
    """A database that recorded rev0 and rev1, and a checkout that only has rev0."""
    _migrate(_config(tmp_path / "newer", [CREATE, REBUILD]))
    return _config(tmp_path / "older", [CREATE])


def test_a_database_ahead_of_the_checkout_has_nothing_pending_and_migrate_applies_nothing(
    database: Path, tmp_path: Path
) -> None:
    config = _ahead(database, tmp_path)
    out = io.StringIO()

    asyncio.run(run_status(out, config))
    assert AHEAD_WARNING in out.getvalue()
    assert "Pending" not in out.getvalue()
    assert "No pending migrations." in out.getvalue()

    out = io.StringIO()
    asyncio.run(run_migrate(out, config))
    assert AHEAD_WARNING in out.getvalue()
    assert "Applying" not in out.getvalue()
    assert "No pending migrations." in out.getvalue()


def test_the_ahead_warning_names_no_host_user_or_path(database: Path, tmp_path: Path) -> None:
    for word in (str(tmp_path), str(database), "sqlite"):
        assert word not in AHEAD_WARNING


def test_db_migrate_exits_zero_when_the_database_is_ahead(
    database: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _ahead(database, tmp_path)
    monkeypatch.setattr("db.migrate.alembic_config", lambda: _config(tmp_path / "older", [CREATE]))

    assert migrate_main() == 0
