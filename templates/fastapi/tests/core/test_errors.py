import json

import pytest
from fastapi.testclient import TestClient

from core.dependency import is_dependency_outage
from core.errors import FAILURES, ApiError, failure_for_status


def failure_body(message: str) -> str:
    return json.dumps({"success": False, "payload": {"message": message}}, separators=(",", ":"))


def test_unknown_route_answers_the_404_entry_of_the_table(client: TestClient) -> None:
    response = client.get("/api/v1/nothing-here")

    assert response.status_code == 404
    assert response.text == failure_body(FAILURES["not_found"][1])


def test_wrong_method_answers_the_405_entry_not_the_framework_text(client: TestClient) -> None:
    response = client.post("/api/v1/hello")

    assert response.status_code == 405
    assert response.text == failure_body(FAILURES["method_not_allowed"][1])


def test_unexpected_error_answers_the_fixed_500_text_with_no_internal_detail(
    client: TestClient,
) -> None:
    response = client.get("/api/v1/__fault/boom")

    assert response.status_code == 500
    assert response.text == failure_body(FAILURES["internal"][1])
    assert "passwd" not in response.text
    assert "SELECT" not in response.text


def test_dependency_outage_answers_503(client: TestClient) -> None:
    response = client.get("/api/v1/__fault/down")

    assert response.status_code == 503
    assert response.text == failure_body(FAILURES["unavailable"][1])


def test_api_error_answers_its_own_table_entry(client: TestClient) -> None:
    response = client.get("/api/v1/__fault/api-error")

    assert response.status_code == 403
    assert response.text == failure_body(FAILURES["forbidden"][1])


def test_validation_failure_answers_the_fixed_400_text_not_the_issue_list(
    client: TestClient,
) -> None:
    response = client.get("/api/v1/__fault/typed?n=abc")

    assert response.status_code == 400
    assert response.text == failure_body(FAILURES["invalid_request"][1])


def test_failure_table_has_no_two_entries_with_the_same_message() -> None:
    messages = [message for _, message in FAILURES.values()]

    assert len(set(messages)) == len(messages)


def test_templated_name_is_shown_only_when_it_is_a_safe_token() -> None:
    assert ApiError("invalid_field", "page_size").message == "invalid value for 'page_size'"
    assert ApiError("invalid_field", "x'; DROP").message == "invalid value for '?'"


def test_unlisted_status_answers_the_400_or_500_entry() -> None:
    assert failure_for_status(418) == FAILURES["invalid_request"]
    assert failure_for_status(502) == FAILURES["internal"]


class SqlStateError(Exception):
    def __init__(self, sqlstate: str) -> None:
        super().__init__("db")
        self.sqlstate = sqlstate


@pytest.mark.parametrize(
    "error",
    [
        ConnectionRefusedError(),
        TimeoutError(),
        SqlStateError("57P01"),
        BaseExceptionGroup("g", [ConnectionResetError()]),
    ],
)
def test_connection_failures_are_outages(error: BaseException) -> None:
    assert is_dependency_outage(error)


def test_a_cause_chain_is_followed() -> None:
    try:
        try:
            raise ConnectionRefusedError()
        except ConnectionRefusedError as inner:
            raise RuntimeError("query failed") from inner
    except RuntimeError as outer:
        assert is_dependency_outage(outer)


@pytest.mark.parametrize("error", [SqlStateError("42P01"), TypeError("x"), ValueError()])
def test_statement_errors_and_bugs_are_not_outages(error: BaseException) -> None:
    assert not is_dependency_outage(error)
