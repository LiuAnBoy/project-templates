"""Process configuration, read once from the environment."""

from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import SettingsConfigDict

from core.rate_limit import parse_trusted_proxies
from infra.settings import InfraSettings


class Settings(InfraSettings):
    """Process configuration.

    Give a field a default for local development unless it names a service the
    server cannot run without; such a setting is required (see
    ``docs/rules/data.md``) and is declared on ``InfraSettings``. Add a field when
    code reads it, and add it to ``.env.example`` with a fake value.

    Attributes:
        host: The interface to listen on.
        port: The port to listen on.
        log_level: The minimum level that is logged.
        rate_limit_max: Requests allowed per client in one window.
        rate_limit_window_seconds: The window of the rate limit, in seconds.
        trust_proxy: Comma-separated addresses or ranges of the reverse proxies in
            front of the server, whose ``x-forwarded-for`` is believed; empty trusts
            none and counts the socket address.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
        case_sensitive=False,
        # A validation message never repeats the value, which may be a secret.
        hide_input_in_errors=True,
    )

    host: str = "0.0.0.0"
    port: int = 8000
    log_level: Literal["TRACE", "DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    rate_limit_max: int = Field(default=300, ge=1)
    rate_limit_window_seconds: int = Field(default=60, ge=1)
    trust_proxy: str = ""

    @field_validator("trust_proxy")
    @classmethod
    def _check_trust_proxy(cls, value: str) -> str:
        """Refuse a blanket or malformed proxy list at boot.

        Args:
            value: The raw setting.

        Returns:
            The setting, unchanged.
        """
        parse_trusted_proxies(value)
        return value


settings = Settings()
