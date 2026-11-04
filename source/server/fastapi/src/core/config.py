"""Process configuration, read once from the environment."""

from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Process configuration.

    Every field has a default for local development, so the server boots with no
    ``.env`` and an empty environment. Add a field when code reads it, and add it
    to ``.env.example`` with a fake value.

    Attributes:
        host: The interface to listen on.
        port: The port to listen on.
        log_level: The minimum level that is logged.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    host: str = "0.0.0.0"
    port: int = 8000
    log_level: Literal["TRACE", "DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"


settings = Settings()
