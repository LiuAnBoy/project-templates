from fastapi import FastAPI
from fastapi.testclient import TestClient

from hello.dependencies import get_greeter


def test_hello_answers_exactly_the_success_envelope(client: TestClient) -> None:
    response = client.get("/api/v1/hello")

    assert response.status_code == 200
    assert response.text == '{"success":true,"payload":{"data":{"message":"hello world!!"}}}'


def test_a_safe_request_id_is_echoed_and_an_unsafe_one_replaced(client: TestClient) -> None:
    safe = client.get("/api/v1/hello", headers={"x-request-id": "req-12345678"})
    unsafe = client.get("/api/v1/hello", headers={"x-request-id": "bad id with spaces"})

    assert safe.headers["x-request-id"] == "req-12345678"
    assert len(unsafe.headers["x-request-id"]) == 36


def test_a_fake_greeter_swapped_at_the_wiring_point_changes_the_answer(
    app: FastAPI, client: TestClient
) -> None:
    class FakeGreeter:
        def greet(self) -> str:
            return "hi from a fake"

    app.dependency_overrides[get_greeter] = lambda: FakeGreeter()

    response = client.get("/api/v1/hello")

    assert response.json() == {"success": True, "payload": {"data": {"message": "hi from a fake"}}}
