import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from core.errors import ApiError
from infra.types import Infra


def _load_example_settings() -> None:
    """Put the fake settings of ``.env.example`` in the environment.

    ``core.config`` reads ``Settings`` when it is imported, so this runs before
    ``main`` is imported. A required setting that ``.env.example`` leaves out
    fails the tests, so the file cannot drift from the settings.
    """
    for line in (Path(__file__).parent.parent / ".env.example").read_text().splitlines():
        text = line.strip()
        if text and not text.startswith("#") and "=" in text:
            key, _, value = text.partition("=")
            os.environ[key.strip()] = value.strip()


_load_example_settings()

import main  # noqa: E402 - must follow _load_example_settings


async def _no_close() -> None:
    """Release nothing."""


def no_store_infra(_config: object = None) -> Infra:
    """An infra seam with no checks and no shared storage."""
    return Infra(checks=(), rate_limit_storage=None, close=_no_close)


@pytest.fixture(autouse=True)
def _stub_infra(monkeypatch: pytest.MonkeyPatch) -> None:
    """Replace the real seam, so the ordinary tests need no service.

    Tests call ``create_app`` themselves and ``TestClient`` runs the lifespan, so
    the seam is replaced where ``main`` looks it up. The factories of a store
    connect on first use, so the real seam behind ``main.app`` touches nothing at
    import, and that app's lifespan never runs in a test. A test that wants a
    check or a storage patches ``main.create_infra`` again.
    """
    monkeypatch.setattr(main, "create_infra", no_store_infra)


def _fault_router() -> APIRouter:
    """Routes that fail or answer in the ways the tests need."""
    router = APIRouter(prefix="/__fault")

    @router.get("/boom")
    async def boom() -> None:
        raise RuntimeError("secret detail: /etc/passwd SELECT * FROM users")

    @router.get("/down")
    async def down() -> None:
        raise RuntimeError("query failed") from ConnectionRefusedError("connect")

    @router.get("/api-error")
    async def api_error() -> None:
        raise ApiError("forbidden")

    @router.get("/typed")
    async def typed(n: int) -> dict[str, int]:
        return {"n": n}

    @router.get("/items/{token}")
    async def item(token: str) -> dict[str, str]:
        return {"token": token}

    return router


@pytest.fixture
def app() -> FastAPI:
    """A fresh application with the fault routes added."""
    application = main.create_app()
    application.include_router(_fault_router(), prefix="/api/v1")
    return application


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    """A client that answers unhandled errors like a server does instead of re-raising them."""
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
