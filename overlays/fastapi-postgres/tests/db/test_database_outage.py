import asyncio
import time
from collections.abc import Awaitable, Callable
from types import SimpleNamespace

import pytest
from sqlalchemy import text

from core.dependency import is_dependency_outage
from core.failure import format_failure
from db.database import DatabaseOptions, create_database

CLOSED_PORT_URL = "postgresql://app:secret-pw@127.0.0.1:1/secret-db"

#: What no log line or failure description may hold.
SECRETS = ("secret-pw", "secret-db", "127.0.0.1", "SECRET-TOKEN-123")


async def _fake_server(handler: Callable[..., Awaitable[None]]) -> tuple[asyncio.Server, str]:
    """A TCP server standing in for a PostgreSQL that misbehaves, and the URL that names it."""
    server = await asyncio.start_server(handler, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    return server, f"postgresql://app:secret-pw@127.0.0.1:{port}/secret-db"


async def _drop(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    await reader.read(1)
    writer.close()


async def _silent(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    await asyncio.sleep(30)


def _query_error(url: str, options: DatabaseOptions | None = None) -> BaseException:
    """Fail a query with a bound value, and return the error."""

    async def attempt() -> BaseException:
        database = create_database(SimpleNamespace(database_url=url), options)
        try:
            await database.transactions.run(
                lambda session: session.execute(
                    text("select cast(:v as text)"), {"v": "SECRET-TOKEN-123"}
                )
            )
        except Exception as error:
            return error
        finally:
            await database.close()
        raise AssertionError("the query did not fail")

    return asyncio.run(attempt())


def test_a_query_on_a_closed_port_fails_with_an_outage_that_logs_no_connection_value() -> None:
    error = _query_error(CLOSED_PORT_URL)

    logged = format_failure(error)

    assert is_dependency_outage(error)
    assert "OperationalError" in logged
    for secret in SECRETS:
        assert secret not in logged


def test_the_probe_on_a_closed_port_is_an_outage() -> None:
    async def attempt() -> BaseException:
        database = create_database(SimpleNamespace(database_url=CLOSED_PORT_URL))
        try:
            await database.probe()
        except Exception as error:
            return error
        finally:
            await database.close()
        raise AssertionError("the probe did not fail")

    assert is_dependency_outage(asyncio.run(attempt()))


def test_a_connection_the_server_drops_is_an_outage() -> None:
    async def attempt() -> BaseException:
        server, url = await _fake_server(_drop)
        try:
            database = create_database(SimpleNamespace(database_url=url))
            try:
                await database.probe()
            except Exception as error:
                return error
            finally:
                await database.close()
        finally:
            server.close()
        raise AssertionError("the probe did not fail")

    error = asyncio.run(attempt())

    assert is_dependency_outage(error)
    assert "secret-pw" not in format_failure(error)


def test_a_server_that_never_answers_is_an_outage_once_the_connect_timeout_passes() -> None:
    async def attempt() -> BaseException:
        server, url = await _fake_server(_silent)
        try:
            database = create_database(
                SimpleNamespace(database_url=url), DatabaseOptions(connect_timeout_seconds=2)
            )
            try:
                await database.probe()
            except Exception as error:
                return error
            finally:
                await database.close()
        finally:
            server.close()
        raise AssertionError("the probe did not fail")

    started = time.monotonic()
    error = asyncio.run(attempt())

    assert time.monotonic() - started < 6
    assert type(error.__cause__).__name__ == "ConnectionTimeout"
    assert is_dependency_outage(error)


def test_a_pool_with_no_connection_to_give_is_an_outage() -> None:
    async def attempt() -> BaseException:
        server, url = await _fake_server(_silent)
        options = DatabaseOptions(pool_size=1, pool_wait_seconds=0.3, connect_timeout_seconds=30)
        database = create_database(SimpleNamespace(database_url=url), options)
        try:
            first = asyncio.ensure_future(database.probe())
            await asyncio.sleep(0.1)
            try:
                await database.probe()
            except Exception as error:
                return error
            finally:
                first.cancel()
                await database.close()
        finally:
            server.close()
        raise AssertionError("the second probe did not fail")

    error = asyncio.run(attempt())

    assert type(error).__name__ == "TimeoutError"
    assert is_dependency_outage(error)


def test_the_probe_and_the_runner_fail_once_the_database_is_closed() -> None:
    async def attempt() -> None:
        database = create_database(SimpleNamespace(database_url=CLOSED_PORT_URL))
        await database.close()
        await database.close()
        with pytest.raises(ConnectionError):
            await database.probe()

    asyncio.run(attempt())


def _message(kind: bytes, body: bytes) -> bytes:
    """One message of the PostgreSQL protocol."""
    return kind + (len(body) + 4).to_bytes(4, "big") + body


async def _refuse_with(
    state: str, text: str, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
) -> None:
    """Answer a TLS request with no, and a login with a FATAL reply."""
    while True:
        data = await reader.read(1024)
        if not data:
            return
        if len(data) == 8:
            writer.write(b"N")
            await writer.drain()
            continue
        fields = f"SFATAL\0VFATAL\0C{state}\0M{text}\0\0".encode()
        writer.write(_message(b"E", fields))
        await writer.drain()
        writer.close()
        return


def _probe_error(url: str) -> BaseException:
    """Fail the probe against a URL, through the real client, and return the error."""

    async def attempt() -> BaseException:
        database = create_database(SimpleNamespace(database_url=url))
        try:
            await database.probe()
        except Exception as error:
            return error
        finally:
            await database.close()
        raise AssertionError("the probe did not fail")

    return asyncio.run(attempt())


def _error_from(state: str, text: str, query: str = "") -> BaseException:
    """Run the probe against a server that refuses the login in one way."""

    async def attempt() -> BaseException:
        async def handler(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            await _refuse_with(state, text, reader, writer)

        server, url = await _fake_server(handler)
        database = create_database(SimpleNamespace(database_url=url + query))
        try:
            await database.probe()
        except Exception as error:
            return error
        finally:
            await database.close()
            server.close()
        raise AssertionError("the probe did not fail")

    return asyncio.run(attempt())


@pytest.mark.parametrize(
    ("state", "text", "note"),
    [
        ("28P01", 'password authentication failed for user "secret-user"', "SQLSTATE 28P01"),
        ("3D000", 'database "secret-db" does not exist', "SQLSTATE 3D000"),
    ],
)
def test_a_refused_login_is_an_outage_and_the_log_tells_it_from_a_lost_network(
    state: str, text: str, note: str
) -> None:
    error = _error_from(state, text)

    logged = format_failure(error)

    assert is_dependency_outage(error)
    assert f"[{note}]" in logged
    for secret in (*SECRETS, "secret-user"):
        assert secret not in logged


def test_a_closed_port_logs_its_errno_and_not_a_note_about_a_login() -> None:
    logged = format_failure(_probe_error(CLOSED_PORT_URL))

    assert "[ECONNREFUSED]" in logged


def test_a_server_that_refuses_tls_is_an_outage() -> None:
    error = _error_from("28P01", "unused", "?sslmode=require")

    assert is_dependency_outage(error)
    assert "[TLS]" in format_failure(error)
