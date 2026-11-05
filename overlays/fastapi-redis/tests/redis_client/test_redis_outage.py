import asyncio
import io
import threading
import time
from collections.abc import Awaitable, Callable, Iterator
from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from loguru import logger
from pydantic import ValidationError

import main
from core import rate_limit
from core.config import Settings
from core.dependency import is_dependency_outage
from core.failure import format_failure
from infra.types import Infra
from redis_client.client import RedisClientOptions, create_redis_client
from redis_client.rate_limit import create_rate_limit_storage

#: Spelled by joining, so no source line of a traceback in a log holds them.
PASSWORD = "-".join(["secret", "pw"])
KEY = "-".join(["secret", "key"])
VALUE = "-".join(["secret", "value"])
HOST = ".".join(["127", "0", "0", "1"])

CLOSED_PORT_URL = f"redis://:{PASSWORD}@{HOST}:1"
SECRETS = (PASSWORD, KEY, VALUE, HOST, "redis://")


@contextmanager
def _serving(handler: Callable[..., Awaitable[None]]) -> Iterator[str]:
    """Serve a misbehaving Redis from a thread of its own, and give the URL that names it."""
    loop = asyncio.new_event_loop()
    server = loop.run_until_complete(asyncio.start_server(handler, HOST, 0))
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    port = server.sockets[0].getsockname()[1]
    try:
        yield f"redis://:{PASSWORD}@{HOST}:{port}"
    finally:
        loop.call_soon_threadsafe(loop.stop)
        thread.join(timeout=5)
        server.close()
        loop.close()


async def _drop(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    await reader.read(1)
    writer.close()


async def _silent(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    await asyncio.sleep(30)


def _failure_of(url: str, options: RedisClientOptions | None = None) -> tuple[BaseException, float]:
    """Run a command that fails against a URL; return the error and how long it took."""

    async def attempt() -> tuple[BaseException, float]:
        redis = create_redis_client(SimpleNamespace(redis_url=url), options)
        started = time.monotonic()
        try:
            await redis.client.set(KEY, VALUE, ex=30)
        except Exception as error:
            return error, time.monotonic() - started
        finally:
            await redis.close()
        raise AssertionError("the command did not fail")

    return asyncio.run(attempt())


def test_a_command_on_a_closed_port_fails_at_once_with_an_outage_that_logs_nothing_it_carried() -> (
    None
):
    error, seconds = _failure_of(CLOSED_PORT_URL)

    logged = format_failure(error)

    assert seconds < 2
    assert is_dependency_outage(error)
    assert "ConnectionError" in logged
    for secret in SECRETS:
        assert secret not in logged


def test_a_closed_port_on_a_name_with_several_addresses_logs_none_of_them() -> None:
    name = "local" + "host"

    error, _ = _failure_of(f"redis://:{PASSWORD}@{name}:1")

    logged = format_failure(error)
    assert is_dependency_outage(error)
    for secret in (name, HOST, "::1", PASSWORD):
        assert secret not in logged


async def _wrong_password(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    while await reader.read(1024):
        writer.write(b"-WRONGPASS invalid username-password pair\r\n")
        await writer.drain()


def test_a_wrong_password_is_an_outage_through_the_real_client() -> None:
    with _serving(_wrong_password) as url:
        error, _ = _failure_of(url)

    assert is_dependency_outage(error)
    assert PASSWORD not in format_failure(error)


@pytest.mark.parametrize(
    "value",
    [
        "redis://:canary-pw@canary-host:canary-port",
        "redis://[canary-host]:6379",
        "redis://canary-host:99999",
        "redis://canary-host:6379/0?socket_timeout=canary",
        "canary",
    ],
)
def test_a_malformed_url_is_refused_by_the_settings_naming_it_and_no_value(value: str) -> None:
    with pytest.raises(ValidationError) as raised:
        Settings(_env_file=None, REDIS_URL=value)  # type: ignore[call-arg]

    assert "REDIS_URL" in str(raised.value)
    assert "canary" not in str(raised.value)


def test_a_connection_the_server_drops_is_an_outage() -> None:
    with _serving(_drop) as url:
        error, _ = _failure_of(url)

    assert is_dependency_outage(error)
    assert HOST not in format_failure(error)


def test_a_server_that_never_answers_ends_in_a_timeout_the_classifier_accepts() -> None:
    with _serving(_silent) as url:
        error, seconds = _failure_of(url, RedisClientOptions(socket_timeout_seconds=0.3))

    assert seconds < 2
    assert type(error).__name__ == "TimeoutError"
    assert is_dependency_outage(error)
    assert HOST not in format_failure(error)


def test_the_probe_fails_on_a_closed_port_and_once_the_client_is_closed() -> None:
    async def attempt() -> None:
        redis = create_redis_client(SimpleNamespace(redis_url=CLOSED_PORT_URL))
        with pytest.raises(Exception) as raised:
            await redis.probe()
        assert is_dependency_outage(raised.value)
        await redis.close()
        await redis.close()
        with pytest.raises(ConnectionError):
            await redis.probe()

    asyncio.run(attempt())


def _app_on(
    url: str, monkeypatch: pytest.MonkeyPatch, options: RedisClientOptions | None = None
) -> TestClient:
    """The real app, whose limiter counts in a Redis client of its own.

    The client is created here but connects, and is closed by the app's shutdown, inside
    the app's own event loop, as the one client of a real process would be.
    """
    redis = create_redis_client(SimpleNamespace(redis_url=url), options)
    monkeypatch.setattr(
        main,
        "create_infra",
        lambda config: Infra(
            checks=(), rate_limit_storage=create_rate_limit_storage(redis.client), close=redis.close
        ),
    )
    return TestClient(main.create_app(Settings(_env_file=None)), client=("10.1.1.1", 5000))


def test_a_request_with_a_dead_redis_answers_the_503_failure_and_logs_nothing_it_carried(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = _app_on(CLOSED_PORT_URL, monkeypatch)  # creating the app configures the logging
    sink = io.StringIO()
    handler = logger.add(sink, format="{message}")
    try:
        with app as client:
            started = time.monotonic()
            response = client.get("/api/v1/hello")
            elapsed = time.monotonic() - started
    finally:
        logger.remove(handler)

    assert response.status_code == 503
    assert response.text == '{"success":false,"payload":{"message":"service unavailable"}}'
    assert elapsed < 2
    logged = sink.getvalue()
    assert "rate limit storage unreachable" in logged
    for secret in SECRETS:
        assert secret not in logged
        assert secret not in response.text


def test_a_request_with_a_silent_redis_answers_the_503_within_the_limiter_bound(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(rate_limit, "STORAGE_TIMEOUT_SECONDS", 0.3)
    with _serving(_silent) as url:
        with _app_on(url, monkeypatch, RedisClientOptions(socket_timeout_seconds=30)) as client:
            started = time.monotonic()
            response = client.get("/api/v1/hello")
            elapsed = time.monotonic() - started

    assert response.status_code == 503
    assert elapsed < 1.5
