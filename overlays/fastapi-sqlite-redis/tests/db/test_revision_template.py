import shutil
import subprocess
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

from db.migrate import ROOT

MESSAGES = [
    "schema change",
    "add note, with trailing comma,",
    "Add the users (v2)",
    "x" * 130,
]


@pytest.mark.parametrize("message", MESSAGES)
def test_a_generated_revision_passes_the_projects_lint_and_format_checks(
    tmp_path: Path, message: str
) -> None:
    """The done gate runs ``make lint`` and ``make format-check`` over a fresh revision."""
    for name in ("pyproject.toml", "alembic.ini"):
        shutil.copy(ROOT / name, tmp_path / name)
    (tmp_path / "alembic" / "versions").mkdir(parents=True)
    shutil.copy(ROOT / "alembic" / "script.py.mako", tmp_path / "alembic" / "script.py.mako")

    command.revision(Config(str(tmp_path / "alembic.ini")), message=message)

    for args in (("check",), ("format", "--check")):
        result = subprocess.run(
            ["ruff", *args, "--no-cache", "."], cwd=tmp_path, capture_output=True, text=True
        )
        assert result.returncode == 0, result.stdout + result.stderr
