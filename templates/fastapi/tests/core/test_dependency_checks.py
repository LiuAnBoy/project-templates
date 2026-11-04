import asyncio
import functools
from collections.abc import Awaitable, Callable

import pytest

from core.dependency_checks import (
    DependencyCheck,
    HealthProbe,
    StartupCheckError,
    run_startup_checks,
)


def _sync(test: Callable[[], Awaitable[None]]) -> Callable[[], None]:
    """Run an async test body on its own event loop; the suite has no async plugin."""

    @functools.wraps(test)
    def run() -> None:
        asyncio.run(test())  # type: ignore[arg-type]

    return run


class _Counting:
    """A check that counts its runs."""

    def __init__(self, outcome: str = "ok") -> None:
        self.runs = 0
        self._outcome = outcome

    def check(self, name: str = "fake") -> DependencyCheck:
        async def run() -> str:
            self.runs += 1
            if self._outcome == "hang":
                await asyncio.Event().wait()
            if self._outcome == "fail":
                raise ConnectionRefusedError("connect ECONNREFUSED secret-host:5432")
            return "up"

        return DependencyCheck(name, run)


@_sync
async def test_a_probe_with_no_checks_is_healthy() -> None:
    assert await HealthProbe(())() is True


@_sync
async def test_concurrent_callers_run_a_counting_fake_once() -> None:
    counting = _Counting()
    probe = HealthProbe([counting.check()])

    answers = await asyncio.gather(probe(), probe(), probe())

    assert answers == [True, True, True]
    assert counting.runs == 1


@_sync
async def test_a_result_is_reused_inside_the_window_and_run_again_after_it() -> None:
    counting = _Counting()
    probe = HealthProbe([counting.check()], cache_seconds=0.05)

    await probe()
    await probe()
    assert counting.runs == 1

    await asyncio.sleep(0.08)
    await probe()
    assert counting.runs == 2


@_sync
async def test_a_failure_is_reused_for_the_window_too_and_reported_once() -> None:
    counting = _Counting("fail")
    reported: list[list[str]] = []
    probe = HealthProbe(
        [counting.check()], cache_seconds=0.5, on_failure=lambda names: reported.append(list(names))
    )

    assert await probe() is False
    assert await probe() is False

    assert counting.runs == 1
    assert reported == [["fake"]]


@_sync
async def test_a_check_that_does_not_answer_fails_within_its_bound() -> None:
    probe = HealthProbe([_Counting("hang").check()], timeout_seconds=0.05)

    assert await probe() is False


@_sync
async def test_a_caller_that_gives_up_does_not_cancel_the_run_the_others_share() -> None:
    counting = _Counting()
    probe = HealthProbe([counting.check()])

    quitter = asyncio.ensure_future(probe())
    stayer = asyncio.ensure_future(probe())
    await asyncio.sleep(0)
    quitter.cancel()

    assert await stayer is True


@_sync
async def test_startup_passes_when_every_check_passes_and_with_none() -> None:
    await run_startup_checks(())
    await run_startup_checks([_Counting().check()])


@_sync
async def test_startup_names_a_failing_check_and_holds_none_of_its_error_text() -> None:
    with pytest.raises(StartupCheckError) as raised:
        await run_startup_checks([_Counting("fail").check()])

    assert str(raised.value) == "dependency check failed: fake"
    assert "secret-host" not in str(raised.value)
    assert raised.value.__cause__ is None
    assert raised.value.__suppress_context__ is False
    assert raised.value.__context__ is None


@_sync
async def test_startup_names_a_check_that_hangs_within_its_bound() -> None:
    with pytest.raises(StartupCheckError) as raised:
        await run_startup_checks([_Counting("hang").check()], seconds=0.05)

    assert str(raised.value) == "dependency check failed: fake"
