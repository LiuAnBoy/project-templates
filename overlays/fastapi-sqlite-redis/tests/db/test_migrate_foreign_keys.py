import asyncio
import io
import shutil
import sqlite3
from pathlib import Path

import pytest
from alembic.config import Config

from db.migrate import ROOT, run_migrate, run_status

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
