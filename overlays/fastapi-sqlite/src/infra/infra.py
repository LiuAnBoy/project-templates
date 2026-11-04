"""The seam between the application and what it depends on."""

from core.dependency_checks import DependencyCheck
from db.database import create_database
from infra.settings import InfraSettings
from infra.types import Infra


def create_infra(config: InfraSettings) -> Infra:
    """Build what the process depends on from its settings.

    ``create_app`` takes the checks, the optional shared limiter storage and the
    close function from here, and nothing else names a store. The database is
    created once, here, and connects on first use; the project passes
    ``session_factory`` and ``transactions`` to the services it wires in ``main.py``.
    A store lost after startup answers 503 and the process stays up.

    Args:
        config: The validated settings; the database's settings are on it.

    Returns:
        The checks, the limiter storage (None: the counts stay in memory), the close
        function, the session factory and the transaction runner.
    """
    database = create_database(config)
    return Infra(
        checks=(DependencyCheck(database.name, database.probe),),
        rate_limit_storage=None,
        close=database.close,
        session_factory=database.session_factory,
        transactions=database.transactions,
    )
