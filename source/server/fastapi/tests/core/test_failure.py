import io
import re
import ssl

import pytest
from loguru import logger

from core.failure import format_failure
from core.logging import configure_logging


class _SqlError(Exception):
    """A statement error that wraps a driver error, as SQLAlchemy's does."""

    def __init__(self, message: str, orig: BaseException) -> None:
        super().__init__(message)
        self.orig = orig


def _driver_error(sqlstate: str, message: str) -> BaseException:
    error = Exception(message)
    error.sqlstate = sqlstate  # type: ignore[attr-defined]
    return error


def _raise_wrapped(driver: BaseException, text: str) -> BaseException:
    try:
        try:
            raise driver
        except Exception as inner:
            raise _SqlError(text, inner) from inner
    except _SqlError as outer:
        return outer


def test_a_value_quoting_driver_message_is_withheld_in_the_driver_error_and_its_wrapper() -> None:
    driver = _driver_error("22P02", 'invalid input syntax for type uuid: "SECRET-TOKEN"')
    wrapped = _raise_wrapped(driver, f"(driver) {driver}\n[SQL: select 1]")

    text = format_failure(wrapped)

    assert "SECRET-TOKEN" not in text
    assert "[SQL: select 1]" in text
    assert "File " in text


def test_the_detail_of_an_integrity_violation_is_withheld() -> None:
    driver = _driver_error(
        "23505", "duplicate key\nDETAIL: Key (email)=(secret@example.com) exists"
    )

    assert "secret@example.com" not in format_failure(_raise_wrapped(driver, f"x {driver}"))


def test_a_statement_error_of_another_class_keeps_its_message() -> None:
    driver = _driver_error("42P01", 'relation "orders" does not exist')

    assert 'relation "orders" does not exist' in format_failure(_raise_wrapped(driver, "x"))


def test_a_connection_failure_keeps_its_class_and_loses_its_message() -> None:
    error = ConnectionRefusedError("[Errno 61] Connect call failed ('10.1.2.3', 6379)")

    text = format_failure(error)

    assert "ConnectionRefusedError" in text
    assert "10.1.2.3" not in text


def test_a_failed_tls_check_under_a_connection_error_loses_the_name_it_quotes() -> None:
    # redis-py wraps the ssl error in its own ConnectionError, so the ssl error is a
    # cause that is not itself an outage.
    check = ssl.SSLCertVerificationError(
        1,
        "[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: Hostname mismatch, "
        "certificate is not valid for 'canary-host.internal'. (_ssl.c:1010)",
    )
    try:
        try:
            raise check
        except ssl.SSLCertVerificationError as cause:
            raise ValueError("handshake failed") from cause
    except ValueError as error:
        text = format_failure(error)

    assert "canary-host" not in text
    assert "SSLCertVerificationError" in text


@pytest.mark.parametrize(
    ("sqlstate", "message"),
    [
        ("28P01", 'password authentication failed for user "canary-user"'),
        ("3D000", 'database "canary-db" does not exist'),
    ],
)
def test_a_refused_login_or_database_loses_the_name_it_quotes(sqlstate: str, message: str) -> None:
    driver = _driver_error(sqlstate, message)

    text = format_failure(_raise_wrapped(driver, f"(driver) {driver}"))

    assert "canary-" not in text


def test_a_context_that_is_not_a_cause_is_described_too() -> None:
    try:
        try:
            raise ConnectionRefusedError("secret-host.internal")
        except ConnectionRefusedError:
            raise RuntimeError("while handling") from None
    except RuntimeError as error:
        assert "secret-host.internal" not in format_failure(error)


def test_logging_a_traceback_goes_through_the_description() -> None:
    sink = io.StringIO()
    configure_logging("INFO")
    sink_id = logger.add(sink, format="{message}", backtrace=False, diagnose=False)
    try:
        try:
            raise ConnectionRefusedError("secret-host.internal")
        except ConnectionRefusedError as error:
            logger.opt(exception=error).error("dependency unreachable")
    finally:
        logger.remove(sink_id)

    logged = sink.getvalue()
    assert "dependency unreachable" in logged
    assert "ConnectionRefusedError" in logged
    assert not re.search("secret-host", logged)
