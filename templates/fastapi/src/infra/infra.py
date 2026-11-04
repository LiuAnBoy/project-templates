"""The seam between the application and what it depends on."""

from infra.settings import InfraSettings
from infra.types import Infra


async def _close() -> None:
    """Release nothing: the base opens nothing."""


def create_infra(config: InfraSettings) -> Infra:
    """Build what the process depends on from its settings.

    ``create_app`` takes the checks, the optional shared limiter storage and the
    close function from here, and nothing else names a store. The base has no
    store, so it returns no checks, no shared storage and a close that does
    nothing, and the server starts and answers as it always has. A data overlay
    replaces this file (and ``settings.py``) with one that creates its store's
    clients, which connect on first use; ``main.py`` does not change.

    Args:
        config: The validated settings; a store's settings are on it.

    Returns:
        The checks, the optional limiter storage and the close function.
    """
    return Infra(checks=(), rate_limit_storage=None, close=_close)
