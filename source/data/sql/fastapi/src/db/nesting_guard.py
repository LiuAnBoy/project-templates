"""The refusal of a ``transactions.run`` from inside an open one, for every SQL store."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass


@dataclass
class _Scope:
    """One open transaction, as the code running inside it sees it.

    Attributes:
        live: True until the transaction has committed or rolled back.
    """

    live: bool = True


class NestingGuard:
    """Refuses a nested ``run`` for exactly as long as the transaction is open.

    A nested ``run`` would wait for a lock or a connection its own caller holds, so it
    is refused at once. A context variable is inherited by every task the unit of work
    starts, and such a task can outlive the transaction. So the variable carries a flag
    that the transaction clears when it has ended, and a late ``run`` from such a task
    opens a transaction of its own. A task started inside and running while the
    transaction is still open is refused like any nested call, because it would deadlock
    the same way on a row the transaction holds.
    """

    def __init__(self, store: str) -> None:
        """Create a guard.

        Args:
            store: The store's name, for the error and the context variable.
        """
        self._store = store
        self._scope: ContextVar[_Scope | None] = ContextVar(f"{store}_run_scope", default=None)

    @asynccontextmanager
    async def entered(self) -> AsyncIterator[None]:
        """Hold one transaction's whole life inside a scope.

        Yields:
            Once the caller may open its transaction.

        Raises:
            RuntimeError: When called from inside a live scope.
        """
        outer = self._scope.get()
        if outer is not None and outer.live:
            raise RuntimeError(
                f"{self._store}: transactions.run was called inside a transaction; "
                "pass the session down instead"
            )
        scope = _Scope()
        token = self._scope.set(scope)
        try:
            yield
        finally:
            scope.live = False
            self._scope.reset(token)
