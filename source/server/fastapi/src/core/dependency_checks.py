"""Dependency checks for the health route and the startup gate.

They cover the things the process cannot run without (a database, a cache).

The base ships none, so a project with no store starts and answers as it always
has. A data overlay hands its checks in through the ``src/infra/`` seam. Every
check runs under :func:`core.bounded.bounded`, so a dependency that hangs fails
the check instead of the caller, and no failure carries the dependency's own
error text further than the log: the answer names a check, never a value.
"""

import asyncio
import time
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass

from core.bounded import bounded

#: How long one check has to answer, in seconds.
CHECK_TIMEOUT_SECONDS = 2.0

#: How long the health route reuses one result, failure included, in seconds.
HEALTH_CACHE_SECONDS = 1.0


@dataclass(frozen=True)
class DependencyCheck:
    """One thing the process depends on.

    Attributes:
        name: Stable name, such as ``postgres``; the only thing a log line or an
            exit message says.
        run: Awaited to check the dependency; it returns when the dependency
            answers and raises when it does not.
    """

    name: str
    run: Callable[[], Awaitable[object]]


class StartupCheckError(RuntimeError):
    """A dependency check failed before the server listened.

    The message names the failed checks and nothing else.

    Attributes:
        names: The names of the checks that failed.
    """

    def __init__(self, names: Sequence[str]) -> None:
        """Build the error from the names alone.

        Args:
            names: The names of the checks that failed.
        """
        super().__init__(f"dependency check failed: {', '.join(names)}")
        self.names = tuple(names)


async def _run_one(check: DependencyCheck, seconds: float) -> str | None:
    """Run one check under a deadline.

    Args:
        check: The check.
        seconds: Its deadline.

    Returns:
        The check's name when it failed or did not answer, otherwise None.
    """
    try:
        await bounded(check.run(), seconds, check.name)
    except Exception:  # any failure of a dependency is a failed check
        return check.name
    return None


async def failed_checks(
    checks: Sequence[DependencyCheck], seconds: float | None = None
) -> list[str]:
    """Run every check at the same time, each under its own deadline.

    Args:
        checks: The checks to run.
        seconds: The deadline of each; defaults to ``CHECK_TIMEOUT_SECONDS``.

    Returns:
        The names of the checks that failed or timed out; it never raises.
    """
    deadline = CHECK_TIMEOUT_SECONDS if seconds is None else seconds
    outcomes = await asyncio.gather(*(_run_one(check, deadline) for check in checks))
    return [name for name in outcomes if name is not None]


async def run_startup_checks(
    checks: Sequence[DependencyCheck], seconds: float | None = None
) -> None:
    """Gate the start: every check must pass before the server listens.

    The error is built from the names alone, because a driver's error text can
    carry the host, the path or the URL, and this message reaches the console.

    Args:
        checks: The checks to run.
        seconds: The deadline of each; defaults to ``CHECK_TIMEOUT_SECONDS``.

    Raises:
        StartupCheckError: Naming each check that failed or timed out.
    """
    failed = await failed_checks(checks, seconds)
    if failed:
        raise StartupCheckError(failed)


class HealthProbe:
    """The probe behind the health route.

    The route is exempt from the rate limit, so a client could otherwise cost one
    store round trip per request and drain the pool the domain routes share.
    Concurrent calls therefore share one in-flight run, and its result, failure
    included, is reused for ``cache_seconds`` after it settles.
    """

    def __init__(
        self,
        checks: Sequence[DependencyCheck],
        *,
        timeout_seconds: float | None = None,
        cache_seconds: float | None = None,
        on_failure: Callable[[Sequence[str]], None] | None = None,
    ) -> None:
        """Create a probe.

        Args:
            checks: The checks to run; none means always healthy.
            timeout_seconds: The deadline of each check; defaults to ``CHECK_TIMEOUT_SECONDS``.
            cache_seconds: How long a result is reused; defaults to ``HEALTH_CACHE_SECONDS``.
            on_failure: Called with the failed names each time a run fails, for the log.
        """
        self._checks = tuple(checks)
        self._timeout = timeout_seconds
        self._cache = HEALTH_CACHE_SECONDS if cache_seconds is None else cache_seconds
        self._on_failure = on_failure
        self._in_flight: asyncio.Task[bool] | None = None
        self._cached: tuple[bool, float] | None = None

    async def _run(self) -> bool:
        """Run the checks once and remember the result, before the callback can fail.

        Returns:
            True when every check passed.
        """
        failed = await failed_checks(self._checks, self._timeout)
        healthy = not failed
        self._cached = (healthy, time.monotonic() + self._cache)
        if failed and self._on_failure is not None:
            try:
                self._on_failure(failed)
            except Exception:  # a failing log callback must not change what the probe answers
                pass
        return healthy

    async def __call__(self) -> bool:
        """Answer whether every dependency is up.

        Returns:
            True when every check passed, or when there is none.
        """
        if not self._checks:
            return True
        if self._cached is not None and time.monotonic() < self._cached[1]:
            return self._cached[0]
        if self._in_flight is None:
            task = asyncio.ensure_future(self._run())
            task.add_done_callback(self._settled)
            self._in_flight = task
        # Shielded, so a caller that disconnects cancels its own wait, not the run
        # the other callers share.
        return await asyncio.shield(self._in_flight)

    def _settled(self, _task: asyncio.Task[bool]) -> None:
        """Forget the finished run, so the next call after the window starts a new one.

        Args:
            _task: The finished run.
        """
        self._in_flight = None
