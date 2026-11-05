import asyncio
import time

import pytest

from core.bounded import bounded
from core.dependency import DependencyTimeoutError, is_dependency_outage
from core.failure import format_failure


def test_it_returns_the_result_and_passes_a_failure_through() -> None:
    async def fails() -> None:
        raise ValueError("own failure")

    async def run() -> None:
        assert await bounded(asyncio.sleep(0, "done"), 1, "store") == "done"
        with pytest.raises(ValueError, match="own failure"):
            await bounded(fails(), 1, "store")

    asyncio.run(run())


def test_the_bound_holds_when_the_work_blocks_while_it_is_cancelled() -> None:
    """As psycopg does on a silent server: it waits for the cancel it sent."""

    async def run() -> tuple[float, bool]:
        ended: list[bool] = []

        async def stubborn() -> None:
            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                await asyncio.sleep(0.4)
                ended.append(True)
                raise

        started = time.monotonic()
        with pytest.raises(TimeoutError):
            await bounded(stubborn(), 0.05, "postgres")
        seconds = time.monotonic() - started
        await asyncio.sleep(0.5)
        return seconds, bool(ended)

    seconds, ended = asyncio.run(run())

    assert seconds < 0.3
    assert ended


def test_the_timeout_names_the_dependency_in_the_log_and_is_an_outage() -> None:
    async def run() -> BaseException:
        try:
            await bounded(asyncio.sleep(5), 0.01, "postgres")
        except DependencyTimeoutError as error:
            return error
        raise AssertionError("no timeout")

    error = asyncio.run(run())

    assert is_dependency_outage(error)
    assert "postgres: no answer in 0.01s" in format_failure(error)


def test_a_late_failure_of_abandoned_work_is_not_reported_as_never_retrieved() -> None:
    reported: list[dict[str, object]] = []

    async def run() -> None:
        asyncio.get_running_loop().set_exception_handler(lambda _l, c: reported.append(c))

        async def fails_late() -> None:
            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                await asyncio.sleep(0.05)
                raise ConnectionError("connection to canary-host failed") from None

        with pytest.raises(TimeoutError):
            await bounded(fails_late(), 0.01, "postgres")
        await asyncio.sleep(0.1)

    asyncio.run(run())

    assert reported == []


def test_a_caller_that_is_cancelled_cancels_the_work() -> None:
    async def run() -> bool:
        cancelled: list[bool] = []

        async def work() -> None:
            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                cancelled.append(True)
                raise

        caller = asyncio.ensure_future(bounded(work(), 30, "store"))
        await asyncio.sleep(0.01)
        caller.cancel()
        with pytest.raises(asyncio.CancelledError):
            await caller
        await asyncio.sleep(0)
        return bool(cancelled)

    assert asyncio.run(run())
