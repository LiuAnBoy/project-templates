import asyncio
import collections
import time
from collections.abc import Awaitable, Callable
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from redis_support import Target, delete_by_prefix, keys_with_prefix, target

import main
from core.config import Settings
from infra.types import Infra
from redis_client.client import RedisPort, create_redis_client
from redis_client.rate_limit import create_rate_limit_storage

TOO_MANY = '{"success":false,"payload":{"message":"too many requests"}}'
UNAVAILABLE = '{"success":false,"payload":{"message":"service unavailable"}}'


def _scenario(body: Callable[[Target, RedisPort], Awaitable[None]]) -> None:
    """Run a test body against a client of the test Redis, and remove its keys after."""

    async def run() -> None:
        where = target()
        redis = create_redis_client(SimpleNamespace(redis_url=where.url))
        try:
            await body(where, redis)
        finally:
            await delete_by_prefix(redis.client, where.prefix)
            await redis.close()

    asyncio.run(run())


def _app_on(where: Target, monkeypatch: pytest.MonkeyPatch, max_: int) -> TestClient:
    """The real app, limited to ``max_`` requests, counting in a Redis client of its own.

    Each app is one instance of the service: its client connects, and is closed by the
    app's shutdown, inside the app's own event loop.
    """
    redis = create_redis_client(SimpleNamespace(redis_url=where.url))
    monkeypatch.setattr(
        main,
        "create_infra",
        lambda config: Infra(
            checks=(),
            rate_limit_storage=create_rate_limit_storage(redis.client, prefix=where.prefix),
            close=redis.close,
        ),
    )
    return TestClient(
        main.create_app(Settings(_env_file=None, rate_limit_max=max_)), client=("10.9.9.9", 5000)
    )


def test_the_probe_answers_with_a_real_round_trip_right_after_the_client_was_created() -> None:
    async def body(where: Target, redis: RedisPort) -> None:
        await redis.probe()

    _scenario(body)


def test_a_key_is_written_with_a_ttl_and_read_back() -> None:
    async def body(where: Target, redis: RedisPort) -> None:
        key = f"{where.prefix}:thing:1"

        await redis.client.set(key, "value", ex=30)

        assert await redis.client.get(key) == b"value"
        assert await redis.client.ttl(key) > 0

    _scenario(body)


def test_the_client_recovers_by_itself_after_the_server_drops_its_connection() -> None:
    async def body(where: Target, redis: RedisPort) -> None:
        await redis.probe()
        killer = create_redis_client(SimpleNamespace(redis_url=where.url))
        try:
            await killer.client.client_kill_filter(_id=await redis.client.client_id())
        finally:
            await killer.close()

        deadline = time.monotonic() + 8
        recovered = False
        while not recovered and time.monotonic() < deadline:
            try:
                await redis.probe()
                recovered = True
            except Exception:
                await asyncio.sleep(0.1)

        assert recovered

    _scenario(body)


def test_two_instances_count_against_one_limit_and_the_429_is_the_failure_envelope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def body(where: Target, redis: RedisPort) -> None:
        def hits() -> list[tuple[int, str]]:
            answers = []
            for _ in range(3):
                with _app_on(where, monkeypatch, 2) as app:  # a new instance for every request
                    response = app.get("/api/v1/hello")
                    answers.append((response.status_code, response.text))
            return answers

        answers = await asyncio.to_thread(hits)

        assert [status for status, _ in answers] == [200, 200, 429]
        assert answers[2][1] == TOO_MANY

    _scenario(body)


def test_every_counter_sits_under_the_service_prefix_with_a_ttl(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def body(where: Target, redis: RedisPort) -> None:
        def hit() -> None:
            with _app_on(where, monkeypatch, 5) as app:
                app.get("/api/v1/hello")

        await asyncio.to_thread(hit)
        keys = await keys_with_prefix(redis.client, where.prefix)

        assert keys
        for key in keys:
            assert key.startswith(f"{where.prefix}:rate-limit:")
            assert await redis.client.pttl(key) > 0

    _scenario(body)


def test_a_frozen_redis_answers_the_503_failure_within_the_bound_and_recovers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def body(where: Target, redis: RedisPort) -> None:
        pauser = create_redis_client(SimpleNamespace(redis_url=where.url))
        try:
            # CLIENT PAUSE stops the server answering every client for a while: a real silent Redis.
            await pauser.client.client_pause(1800)

            def hit() -> tuple[int, str, float]:
                with _app_on(where, monkeypatch, 5) as app:
                    started = time.monotonic()
                    response = app.get("/api/v1/hello")
                    return response.status_code, response.text, time.monotonic() - started

            status, text, seconds = await asyncio.to_thread(hit)
            await asyncio.sleep(1.2)
        finally:
            await pauser.close()

        assert (status, text) == (503, UNAVAILABLE)
        assert seconds < 1.6
        await redis.probe()

    _scenario(body)


def _burst(app: TestClient, size: int) -> tuple[collections.Counter[int], float]:
    """Send ``size`` requests at once; return how many got each status, and how long it took."""
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=size) as threads:
        statuses = list(threads.map(lambda _: app.get("/api/v1/hello").status_code, range(size)))
    return collections.Counter(statuses), time.monotonic() - started


def test_a_burst_larger_than_the_pool_queues_and_is_counted_so_the_excess_gets_429(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Reproduces 300 concurrent requests against a pool of 100 connections: no 503."""

    async def body(where: Target, redis: RedisPort) -> None:
        def run() -> collections.Counter[int]:
            with _app_on(where, monkeypatch, 100) as app:
                return _burst(app, 300)[0]

        assert await asyncio.to_thread(run) == {200: 100, 429: 200}

    _scenario(body)


def test_a_burst_against_a_frozen_redis_answers_503_for_every_request_within_the_bound(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The queue for a connection is bounded: nothing waits longer than the limiter's second."""

    async def body(where: Target, redis: RedisPort) -> None:
        pauser = create_redis_client(SimpleNamespace(redis_url=where.url))
        try:
            await pauser.client.client_pause(2500)

            def run() -> tuple[collections.Counter[int], float]:
                with _app_on(where, monkeypatch, 100) as app:
                    return _burst(app, 300)

            counts, seconds = await asyncio.to_thread(run)
            await asyncio.sleep(1.5)
        finally:
            await pauser.close()

        assert counts == {503: 300}
        assert seconds < 2.4

    _scenario(body)
