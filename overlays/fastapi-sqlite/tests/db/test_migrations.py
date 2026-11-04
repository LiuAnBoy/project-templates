from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory

from db.migrate import (
    ahead_of_disk,
    describe_migrate_failure,
    pending_revisions,
    revisions_on_disk,
)
from db.types import MigrationError


def _script(root: Path, revisions: list[tuple[str, str | None]]) -> ScriptDirectory:
    """A migration folder holding (revision, down_revision) pairs."""
    folder = root / "alembic"
    (folder / "versions").mkdir(parents=True)
    for revision, down in revisions:
        (folder / "versions" / f"{revision}.py").write_text(
            f'"""step {revision}\n\nmore"""\n\nrevision = "{revision}"\n'
            f"down_revision = {down!r}\nbranch_labels = None\ndepends_on = None\n"
        )
    config = Config()
    config.set_main_option("script_location", str(folder))
    return ScriptDirectory.from_config(config)


def test_every_revision_is_pending_when_nothing_is_recorded(tmp_path: Path) -> None:
    script = _script(tmp_path, [("a", None), ("b", "a"), ("c", "b")])

    assert [rev.id for rev in pending_revisions(script, ())] == ["a", "b", "c"]
    assert revisions_on_disk(script)[0].message == "step a"


def test_only_what_comes_after_the_recorded_revision_is_pending(tmp_path: Path) -> None:
    script = _script(tmp_path, [("a", None), ("b", "a"), ("c", "b")])

    assert [rev.id for rev in pending_revisions(script, ("b",))] == ["c"]
    assert pending_revisions(script, ("c",)) == []


def test_a_recorded_revision_the_checkout_lacks_is_ahead_of_disk(tmp_path: Path) -> None:
    script = _script(tmp_path, [("a", None)])

    assert ahead_of_disk(script, ("zzz",))
    assert not ahead_of_disk(script, ("a",))
    assert [rev.id for rev in pending_revisions(script, ("zzz",))] == ["a"]


def test_several_heads_fail_naming_them(tmp_path: Path) -> None:
    script = _script(tmp_path, [("a", None), ("b", "a"), ("c", "a")])

    with pytest.raises(MigrationError, match="2 heads"):
        revisions_on_disk(script)


def test_a_failure_to_connect_prints_fixed_text_and_the_code_and_no_connection_value() -> None:
    error = ConnectionRefusedError(
        61, "Connect call failed ('10.9.8.7', 5432) for user secret-user"
    )

    text = describe_migrate_failure(error)

    assert "ECONNREFUSED" in text
    assert "10.9.8.7" not in text
    assert "secret-user" not in text


def test_an_error_group_with_an_empty_message_never_prints_an_empty_line() -> None:
    group = BaseExceptionGroup("", [ValueError("the real cause")])

    text = describe_migrate_failure(group)

    assert "the real cause" in text
    assert all(line.strip() for line in text.splitlines())


def test_an_error_with_no_message_still_prints_its_class() -> None:
    assert describe_migrate_failure(RuntimeError()) == "Migration failed: RuntimeError"


class _Statement(Exception):
    """Shaped like SQLAlchemy's statement error."""

    def __init__(self, orig: BaseException) -> None:
        super().__init__("(driver) message\n[SQL: insert into t values (%(v)s)]")
        self.statement = "insert into t values (%(v)s)"
        self.params = {"v": "SECRET-TOKEN"}
        self.orig = orig
        self.__cause__ = orig


def test_a_failed_statement_prints_the_statement_and_a_value_free_cause() -> None:
    cause = Exception('invalid input syntax for type uuid: "SECRET-TOKEN"')
    cause.sqlstate = "22P02"  # type: ignore[attr-defined]

    text = describe_migrate_failure(_Statement(cause))

    assert "Failed statement: insert into t values (%(v)s)" in text
    assert "SECRET-TOKEN" not in text


def test_a_cause_of_another_class_is_printed() -> None:
    cause = Exception('relation "t" already exists')
    cause.sqlstate = "42P07"  # type: ignore[attr-defined]

    assert 'relation "t" already exists' in describe_migrate_failure(_Statement(cause))
