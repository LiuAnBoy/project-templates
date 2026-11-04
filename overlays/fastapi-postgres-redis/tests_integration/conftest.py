"""Settings for the store tests.

The store tests run against the services the project's own ``.env`` names, never
against the fake values of ``.env.example``: ``.env`` fills every setting that the
process environment does not already hold. ``core.config`` reads its settings when it
is imported, so this runs first.
"""

import os
from pathlib import Path


def _load_dotenv() -> None:
    """Put the settings of ``.env``, when the file exists, in the environment."""
    path = Path(__file__).parent.parent / ".env"
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        text = line.strip()
        if text and not text.startswith("#") and "=" in text:
            key, _, value = text.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


_load_dotenv()
os.environ.setdefault("LOG_LEVEL", "CRITICAL")
