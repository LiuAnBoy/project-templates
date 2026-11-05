"""The reporting around Alembic's migrator, shared by every SQL store.

``make db-migrate`` applies what the database has not recorded and ``make
db-status`` lists it. Everything printed is names and counts, never a connection
value: a failure to reach the database prints fixed text and a code, because the
driver's own message carries the host, the user, the database or the path.
``db.database`` supplies the engine and the store's own checks.
"""

import asyncio
import errno
import sys
from collections.abc import Awaitable, Callable, Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TextIO

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from alembic.script.revision import RevisionError
from alembic.util import CommandError
from pydantic import ValidationError
from sqlalchemy import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from core.dependency import is_outage_link
from core.failure import walk_errors
from db.database import (
    DatabaseSettings,
    create_migration_engine,
    database_exists,
    verify_migrated,
)
from db.types import MigrationError

#: The project root, where ``alembic.ini`` lives.
ROOT = Path(__file__).resolve().parents[2]

#: What ``db-migrate`` and ``db-status`` print when the database is ahead of the checkout.
AHEAD_WARNING = (
    "Warning: the database recorded a migration this checkout does not contain. "
    "An older release is being deployed over a newer one. Nothing is applied."
)

#: SQLSTATE classes of a database that cannot be reached or used: connection (08),
#: invalid authorization (28), invalid catalog name (3D) and the server going away (57P0).
_CONNECTION_STATES = ("08", "28", "3D", "57P0")

#: SQLSTATE classes whose server message quotes a value.
_VALUE_STATES = ("22", "23")


@dataclass(frozen=True)
class Revision:
    """One migration on disk.

    Attributes:
        id: The revision id, which is also what the file name carries.
        message: The first line of its docstring.
    """

    id: str
    message: str


def alembic_config() -> Config:
    """Read the project's ``alembic.ini``.

    Returns:
        The configuration.
    """
    return Config(str(ROOT / "alembic.ini"))


def revisions_on_disk(script: ScriptDirectory) -> list[Revision]:
    """List every migration on disk, oldest first.

    Args:
        script: The migration folder.

    Returns:
        The revisions.

    Raises:
        MigrationError: When the folder has more than one head, which Alembic cannot
            upgrade until a merge revision joins them.
    """
    heads = script.get_heads()
    if len(heads) > 1:
        raise MigrationError(
            f"The migrations have {len(heads)} heads ({', '.join(sorted(heads))}). "
            "Join them with `alembic merge` and commit the merge revision."
        )
    return [
        Revision(rev.revision, (rev.doc or "").splitlines()[0] if rev.doc else "")
        for rev in reversed(list(script.walk_revisions()))
    ]


def ahead_of_disk(script: ScriptDirectory, current: Iterable[str]) -> bool:
    """Tell whether the database recorded a migration this checkout does not contain.

    Args:
        script: The migration folder.
        current: The revision ids the database records.

    Returns:
        True when an older release is being deployed over a newer one.
    """
    for revision_id in current:
        try:
            script.get_revision(revision_id)
        except (CommandError, RevisionError):
            return True
    return False


def pending_revisions(script: ScriptDirectory, current: Iterable[str]) -> list[Revision]:
    """List the migrations the database has not recorded, in the order they apply.

    A database that recorded a migration this checkout lacks is ahead of it, and
    nothing is pending: Alembic cannot upgrade from a revision it cannot find, and
    the newer release has already applied whatever this one carries.

    Args:
        script: The migration folder.
        current: The revision ids the database records (``alembic_version``).

    Returns:
        The pending revisions, oldest first.
    """
    current = tuple(current)
    revisions = revisions_on_disk(script)
    if ahead_of_disk(script, current):
        return []
    applied: set[str] = set()
    for revision_id in current:
        applied.update(rev.revision for rev in script.iterate_revisions(revision_id, "base"))
    return [rev for rev in revisions if rev.id not in applied]


def _report(out: TextIO, heading: str, revisions: Sequence[Revision]) -> None:
    """Write a list of revisions under a heading.

    Args:
        out: Where to write.
        heading: The heading line.
        revisions: The revisions to list.
    """
    out.write(f"{heading}\n")
    for revision in revisions:
        out.write(f"  - {revision.id} {revision.message}".rstrip() + "\n")


def _current(connection: Connection) -> tuple[str, ...]:
    """Read the revisions the database records.

    Args:
        connection: A synchronous view of the async connection.

    Returns:
        The recorded revision ids, empty when nothing is recorded yet.
    """
    return MigrationContext.configure(connection).get_current_heads()


async def _read_current(engine: AsyncEngine) -> tuple[str, ...]:
    """Read the recorded revisions on a connection of its own.

    Args:
        engine: The migration engine.

    Returns:
        The recorded revision ids.
    """
    async with engine.connect() as connection:
        return await connection.run_sync(_current)


def _upgrade(connection: Connection, config: Config) -> None:
    """Run ``alembic upgrade head`` on a connection that the caller commits.

    Args:
        connection: A synchronous view of the async connection.
        config: The Alembic configuration.
    """
    config.attributes["connection"] = connection
    command.upgrade(config, "head")


async def _verify(engine: AsyncEngine) -> None:
    """Run the store's own check of the data on a connection of its own.

    Args:
        engine: The migration engine.
    """
    async with engine.connect() as connection:
        await connection.run_sync(verify_migrated)


async def run_migrate(out: TextIO | None = None, config: Config | None = None) -> None:
    """Apply every migration the database has not recorded, and report it.

    Prints the counts, the names before applying and the record after, warns when
    the database holds a migration this checkout lacks, and fails when the migrator
    leaves work behind or the store's verification finds a problem, which runs also
    when nothing was pending, so a violation a migration left behind keeps failing.

    Args:
        out: Where the report goes; defaults to stdout.
        config: The Alembic configuration; defaults to the project's.

    Raises:
        MigrationError: On several heads, or a migrator that left work behind.
        Exception: Any failure of the store, for ``describe_migrate_failure``.
    """
    out = out or sys.stdout
    config = config or alembic_config()
    script = ScriptDirectory.from_config(config)
    total = len(revisions_on_disk(script))
    engine = create_migration_engine(DatabaseSettings(), create=True)
    try:
        current = await _read_current(engine)
        pending = pending_revisions(script, current)
        out.write(f"Migrations on disk: {total}, already applied: {total - len(pending)}\n")
        if ahead_of_disk(script, current):
            out.write(f"{AHEAD_WARNING}\n")
        if not pending:
            out.write("No pending migrations.\n")
            await _verify(engine)
            return
        _report(out, f"Applying {len(pending)} pending migration(s):", pending)
        async with engine.begin() as connection:
            await connection.run_sync(_upgrade, config)
        await _verify(engine)
        left = pending_revisions(script, await _read_current(engine))
        if left:
            _report(out, "Migrations remained unapplied:", left)
            raise MigrationError("The migrator reported success but left work behind.")
        _report(out, "Recorded in alembic_version:", pending)
    finally:
        await engine.dispose()


async def run_status(out: TextIO | None = None, config: Config | None = None) -> None:
    """List the migrations that are still pending; never writes.

    A database that does not exist yet, or has no record table, has nothing applied.

    Args:
        out: Where the report goes; defaults to stdout.
        config: The Alembic configuration; defaults to the project's.

    Raises:
        MigrationError: On several heads.
        Exception: Any failure of the store, for ``describe_migrate_failure``.
    """
    out = out or sys.stdout
    config = config or alembic_config()
    script = ScriptDirectory.from_config(config)
    total = len(revisions_on_disk(script))
    settings = DatabaseSettings()
    current: tuple[str, ...] = ()
    if database_exists(settings):
        engine = create_migration_engine(settings, create=False)
        try:
            current = await _read_current(engine)
        finally:
            await engine.dispose()
    pending = pending_revisions(script, current)
    out.write(f"Migrations on disk: {total}, already applied: {total - len(pending)}\n")
    if ahead_of_disk(script, current):
        out.write(f"{AHEAD_WARNING}\n")
    if not pending:
        out.write("No pending migrations.\n")
        return
    _report(out, f"Pending migrations ({len(pending)}):", pending)


def _code_of(link: BaseException) -> str | None:
    """Find the code an error carries: a SQLSTATE, a SQLite result name or an errno.

    Args:
        link: One error in the chain.

    Returns:
        The code, or None.
    """
    for attribute in ("sqlstate", "pgcode", "sqlite_errorname"):
        value = getattr(link, attribute, None)
        if isinstance(value, str) and value:
            return value
    number = getattr(link, "errno", None)
    return errno.errorcode.get(number) if isinstance(number, int) else None


def _is_client_side_driver_error(link: BaseException) -> bool:
    """Tell whether an error is psycopg refusing something before the server was asked.

    A connection option that libpq does not know (``?CANARYKEY=1``) raises a
    ``ProgrammingError`` that lists the host, the port and the address it resolved, and
    carries no SQLSTATE because no server answered. Every statement the server rejected
    has one.

    Args:
        link: One error in the chain.

    Returns:
        True for an error of psycopg that has no SQLSTATE.
    """
    return getattr(link, "sqlstate", None) is None and any(
        cls.__module__.split(".")[0] == "psycopg" and cls.__name__ == "Error"
        for cls in type(link).__mro__
    )


def _is_connection_failure(link: BaseException) -> bool:
    """Tell whether an error says the database could not be reached, opened or used.

    Args:
        link: One error in the chain.

    Returns:
        True for a connection failure, a login refusal, a missing database, a TLS
        failure, a file-system error and a connection option the driver refused; their
        messages name the host, the user, the database or the path.
    """
    code = _code_of(link) or ""
    return (
        is_outage_link(link)
        or code.startswith(_CONNECTION_STATES)
        or isinstance(link, OSError)
        or _is_client_side_driver_error(link)
    )


def describe_migrate_failure(error: BaseException) -> str:
    """Turn a failure of a migration command into what is safe to print.

    A failure to reach the database prints fixed text and the codes found on the
    chain. Any other failure prints its statement, when it has one, and the message
    of every link under it, so the root cause is never lost; bound values are never
    printed, and neither is a driver message that quotes one.

    Args:
        error: Whatever was raised.

    Returns:
        One or more lines, never empty.
    """
    links = list(walk_errors(error))
    if any(_is_connection_failure(link) for link in links):
        codes = sorted({code for link in links if (code := _code_of(link))})
        suffix = f" ({', '.join(codes)})" if codes else ""
        return (
            f"Cannot reach or open the database{suffix}. "
            "Check DATABASE_URL and that the server is running."
        )
    lines: list[str] = []
    under_statement = False
    for link in links:
        statement = getattr(link, "statement", None)
        code = _code_of(link) or ""
        if isinstance(statement, str) and statement.strip():
            text = f"Failed statement: {statement.strip()}"
            under_statement = True
        elif under_statement and code.startswith(_VALUE_STATES):
            text = ""
        else:
            text = str(link).strip()
        if text and text not in lines:
            lines.append(text)
    if not lines:
        return f"Migration failed: {type(error).__name__}"
    return "\n".join(
        line if index == 0 else f"  caused by: {line}" for index, line in enumerate(lines)
    )


def _run(task: Callable[[], Awaitable[None]]) -> int:
    """Run a command and turn a failure into a message on stderr and exit code 1.

    A setting the server would refuse is refused in the server's own words, by the same
    validator, before anything touches the store.

    Args:
        task: The command.

    Returns:
        The exit code.
    """
    try:
        asyncio.run(task())
    except ValidationError as error:
        names = dict.fromkeys(str(issue["loc"][0]).upper() for issue in error.errors())
        sys.stderr.write(f"invalid configuration: {', '.join(names)}\n")
        return 1
    except Exception as error:  # any failure is reported, never raised raw
        sys.stderr.write(f"{describe_migrate_failure(error)}\n")
        return 1
    return 0


def migrate_main() -> int:
    """Entry point of ``scripts/db_migrate.py``.

    Returns:
        The exit code.
    """
    return _run(run_migrate)


def status_main() -> int:
    """Entry point of ``scripts/db_status.py``.

    Returns:
        The exit code.
    """
    return _run(run_status)
