from collections.abc import Iterator

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from core.errors import ApiError
from main import create_app


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
    application = create_app()
    application.include_router(_fault_router(), prefix="/api/v1")
    return application


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    """A client that answers unhandled errors like a server does instead of re-raising them."""
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
