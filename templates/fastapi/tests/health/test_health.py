from fastapi.testclient import TestClient

from core.config import Settings
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
