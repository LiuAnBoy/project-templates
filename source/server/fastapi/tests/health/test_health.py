import time

import pytest
from fastapi.testclient import TestClient

import main
from core import dependency_checks
from core.config import Settings
from core.dependency_checks import DependencyCheck
from infra.types import Infra
from main import create_app


def test_health_answers_exactly_the_bare_status_outside_the_envelope(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.text == '{"status":"ok"}'


def test_health_an_unknown_route_still_answers_the_404_envelope(
    client: TestClient,
) -> None:
    response = client.get("/api/v1/no-such-route")

    assert response.status_code == 404
    assert response.text == '{"success":false,"payload":{"message":"not found"}}'


def test_health_still_answers_200_for_a_client_that_is_over_the_rate_limit() -> None:
    client = TestClient(create_app(Settings(_env_file=None, rate_limit_max=1)))

    client.get("/api/v1/hello")
    limited = client.get("/api/v1/hello")
    health = client.get("/api/health")

    assert limited.status_code == 429
    assert health.status_code == 200
    assert health.text == '{"status":"ok"}'


async def _up() -> str:
    return "up"


async def _down() -> None:
    raise ConnectionRefusedError("connect ECONNREFUSED secret-host:1")


async def _hang() -> None:
    import asyncio

    await asyncio.Event().wait()


async def _no_close() -> None:
    return None


def _client_with(
    monkeypatch: pytest.MonkeyPatch, check: DependencyCheck, **values: object
) -> TestClient:
    """A client whose seam holds one fake check."""
    monkeypatch.setattr(
        main,
        "create_infra",
        lambda config: Infra(checks=(check,), rate_limit_storage=None, close=_no_close),
    )
    return TestClient(create_app(Settings(_env_file=None, **values)))  # type: ignore[arg-type]


def test_health_answers_exactly_the_bare_status_when_a_passing_check_is_installed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client_with(monkeypatch, DependencyCheck("secret-store", _up))

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.text == '{"status":"ok"}'


def test_health_answers_exactly_503_unavailable_naming_no_check_when_a_check_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client_with(monkeypatch, DependencyCheck("secret-store", _down))

    response = client.get("/api/health")

    assert response.status_code == 503
    assert response.text == '{"status":"unavailable"}'
    assert "secret" not in response.text


def test_health_answers_503_within_the_bound_when_a_check_hangs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(dependency_checks, "CHECK_TIMEOUT_SECONDS", 0.05)
    client = _client_with(monkeypatch, DependencyCheck("secret-store", _hang))
    started = time.monotonic()

    response = client.get("/api/health")

    assert response.status_code == 503
    assert response.text == '{"status":"unavailable"}'
    assert time.monotonic() - started < 1.0


def test_health_stays_exempt_from_the_rate_limit_while_a_check_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client_with(monkeypatch, DependencyCheck("secret-store", _down), rate_limit_max=1)

    client.get("/api/v1/hello")
    limited = client.get("/api/v1/hello")
    first = client.get("/api/health")
    second = client.get("/api/health")

    assert limited.status_code == 429
    assert first.status_code == 503
    assert second.status_code == 503
