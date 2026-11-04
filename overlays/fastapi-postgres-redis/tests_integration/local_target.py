"""The hosts a store test may run against: the machine itself."""

import os
from collections.abc import Mapping
from urllib.parse import parse_qs, urlsplit

LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


def require_local_url(name: str, env: Mapping[str, str] | None = None) -> str:
    """Read a test connection URL and refuse one that points off this machine.

    A test that creates and drops things must never touch a shared server. Store
    tests fail rather than skip when the variable is missing: a run that skipped its
    store tests would read as a pass.

    Args:
        name: The variable to read, such as ``TEST_DATABASE_URL``.
        env: The environment to read; defaults to ``os.environ``.

    Returns:
        The URL.

    Raises:
        RuntimeError: When the variable is missing, is not a URL, names a host that is
            not local, or overrides the host in its query. The message never holds the URL.
    """
    value = (os.environ if env is None else env).get(name)
    if not value:
        raise RuntimeError(
            f"{name} is required: copy .env.example to .env and start the services "
            "before running the integration tests"
        )
    try:
        parts = urlsplit(value)
        host = parts.hostname
        query = parse_qs(parts.query)
    except ValueError:
        raise RuntimeError(f"{name} is not a URL") from None
    if not parts.scheme or host is None:
        raise RuntimeError(f"{name} is not a URL")
    # The driver takes the server from ``?host=`` or ``?hostaddr=`` ahead of the
    # authority, so a URL naming localhost can still point somewhere else.
    if "host" in query or "hostaddr" in query:
        raise RuntimeError(
            f"{name} sets host or hostaddr in its query; "
            "the integration tests only run against this machine"
        )
    if host not in LOCAL_HOSTS:
        raise RuntimeError(
            f"{name} names a host that is not local; "
            "the integration tests only run against this machine"
        )
    return value
