from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from loguru import logger

from core.middleware import UNMATCHED_ROUTE


@pytest.fixture
def lines() -> Iterator[list[str]]:
    captured: list[str] = []
    handler_id = logger.add(
        lambda message: captured.append(str(message)),
        level="INFO",
        filter=lambda record: record["name"] == "core.middleware",
    )
    yield captured
    logger.remove(handler_id)


def test_access_log_records_the_route_pattern_and_never_the_concrete_url(
    client: TestClient, lines: list[str]
) -> None:
    client.get("/api/v1/__fault/items/secret-token-123?key=hunter2")

    log = "".join(lines)
    assert "/api/v1/__fault/items/{token}" in log
    assert "secret-token-123" not in log
    assert "hunter2" not in log


def test_access_log_records_a_placeholder_for_an_unmatched_path(
    client: TestClient, lines: list[str]
) -> None:
    client.get("/api/v1/typed-by-a-caller-4242")

    log = "".join(lines)
    assert UNMATCHED_ROUTE in log
    assert "typed-by-a-caller-4242" not in log


def test_access_log_records_the_status_actually_answered_for_an_outage(
    client: TestClient, lines: list[str]
) -> None:
    response = client.get("/api/v1/__fault/down")

    assert response.status_code == 503
    assert "status=503" in "".join(lines)


def test_access_log_never_writes_free_text_from_a_forwarded_header(
    client: TestClient, lines: list[str]
) -> None:
    client.get("/api/v1/hello", headers={"x-forwarded-for": "fake-user-typed-this"})

    log = "".join(lines)
    assert "fake-user-typed-this" not in log
    assert "client=unknown" in log


def test_access_log_never_writes_a_bearer_token(client: TestClient, lines: list[str]) -> None:
    client.get("/api/v1/hello", headers={"authorization": "Bearer sekrit-token"})

    assert "sekrit-token" not in "".join(lines)
