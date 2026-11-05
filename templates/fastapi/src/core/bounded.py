"""A deadline for calls to a dependency."""

import asyncio
from collections.abc import Awaitable

from core.dependency import DependencyTimeoutError

#: The work that outlived its deadline. The event loop keeps only a weak reference to a
#: task, so these are held here until they end.
_ABANDONED: set[asyncio.Future[object]] = set()


def _settle(task: asyncio.Future[object]) -> None:
    """Forget a finished task of ``_ABANDONED``, and mark its failure as seen.

    Nobody is waiting for it, so without this the loop would report the failure as
    never retrieved, long after the request was answered.

    Args:
        task: The finished task.
    """
    _ABANDONED.discard(task)
    if not task.cancelled():
        task.exception()


def _abandon(task: asyncio.Future[object]) -> None:
    """Cancel work nobody waits for any more, and let it end on its own.

    Args:
        task: The work.
    """
    _ABANDONED.add(task)
    task.add_done_callback(_settle)
    task.cancel()


async def bounded[T](work: Awaitable[T], seconds: float, what: str) -> T:
    """Fail if a dependency has not answered in time.

    Clients of a dead dependency usually wait instead of failing: a pool waits
    for a slot, a client queues commands while it reconnects. Without a bound a
    broken dependency produces a request that never finishes, which reads as
    "still working" and leaves nothing in the log. Wrap every dependency call on
    the request path, with the scope that holds its session inside the call:
    the caller goes on at the deadline, so nothing it does next may need the
    connection the work still holds.

    The caller's wait ends at the deadline even when the work does not stop when it
    is cancelled, as a driver does that first tries to cancel the statement on a
    server that no longer answers. So the work runs as a task of its own, and is
    cancelled and left to end by itself, holding its connection until it does. A
    failure it raises later goes nowhere.

    Args:
        work: The operation to bound.
        seconds: How long it has.
        what: Named in the error, so the log says which dependency it was.

    Returns:
        The operation's result.

    Raises:
        DependencyTimeoutError: A ``TimeoutError``, when it has not answered within the
            deadline.
    """
    task = asyncio.ensure_future(work)
    try:
        done, _pending = await asyncio.wait({task}, timeout=seconds)
    except asyncio.CancelledError:
        _abandon(task)
        raise
    if done:
        return task.result()
    _abandon(task)
    raise DependencyTimeoutError(f"{what}: no answer in {seconds}s")
