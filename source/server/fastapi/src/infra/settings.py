"""The settings of the infrastructure, as the base class of ``Settings``."""

from pydantic_settings import BaseSettings


class InfraSettings(BaseSettings):
    """The connection settings of the infrastructure.

    Empty in the base, which needs none. A data overlay replaces this file with a
    class that declares its connection settings, required and validated with the
    rest at boot; ``core.config.Settings`` extends it, so nothing else changes.
    """
