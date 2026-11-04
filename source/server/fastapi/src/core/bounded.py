"""A deadline for calls to a dependency."""

import asyncio
from collections.abc import Awaitable


async def bounded[T](work: Awaitable[T], seconds: float, what: str) -> T:
    """Fail if a dependency has not answered in time.

    Clients of a dead dependency usually wait instead of failing: a pool waits
    for a slot, a client queues commands while it reconnects. Without a bound a
    broken dependency produces a request that never finishes, which reads as
    "still working" and leaves nothing in the log. Wrap every dependency call on
    the request path.

    Args:
        work: The operation to bound.
        seconds: How long it has.
        what: Named in the error, so the log says which dependency it was.

    Returns:
        The operation's result.

    Raises:
        TimeoutError: When it has not answered within the deadline.
    """
    try:
        async with asyncio.timeout(seconds):
            return await work
    except TimeoutError as error:
        raise TimeoutError(f"{what}: no answer in {seconds}s") from error
