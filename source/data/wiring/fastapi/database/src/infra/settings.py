"""The settings of the infrastructure: the connection of the database."""

from db.database import DatabaseSettings


class InfraSettings(DatabaseSettings):
    """The connection settings of the infrastructure, required and validated at boot.

    ``core.config.Settings`` extends this, so a missing or malformed setting stops the
    boot naming the variable and never its value.
    """
