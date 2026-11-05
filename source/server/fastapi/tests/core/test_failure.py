import io
import re
import ssl

import pytest
from loguru import logger

from core.dependency import DependencyClosedError
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


def test_a_withheld_message_keeps_its_sqlstate() -> None:
    driver = _driver_error("28P01", 'password authentication failed for user "canary-user"')

    text = format_failure(_raise_wrapped(driver, f"x {driver}"))

    assert "[SQLSTATE 28P01]" in text
    assert "canary-user" not in text


def test_a_unique_violation_keeps_its_constraint_name_and_not_its_key() -> None:
    driver = _driver_error(
        "23505", "duplicate key\nDETAIL: Key (email)=(canary@example.com) exists"
    )
    driver.diag = type("Diag", (), {"constraint_name": "users_email_key"})()  # type: ignore[attr-defined]

    text = format_failure(_raise_wrapped(driver, f"x {driver}"))

    assert "[SQLSTATE 23505, constraint users_email_key]" in text
    assert "canary" not in text


def test_a_constraint_name_that_does_not_look_like_a_name_is_left_out() -> None:
    driver = _driver_error("23505", "duplicate key")
    driver.diag = type("Diag", (), {"constraint_name": "a b=(canary)"})()  # type: ignore[attr-defined]

    assert "canary" not in format_failure(_raise_wrapped(driver, f"x {driver}"))


@pytest.mark.parametrize(
    ("text", "note"),
    [
        ('server failed: FATAL:  password authentication failed for "canary"', "SQLSTATE 28P01"),
        ('FATAL:  database "canary" does not exist', "SQLSTATE 3D000"),
        ('at "canary" failed: Connection refused', "ECONNREFUSED"),
        ('at "canary" failed: server does not support SSL, but SSL was required', "TLS"),
        ('at "canary" failed: timeout expired', "ETIMEDOUT"),
    ],
)
def test_an_error_with_no_code_gets_its_note_from_the_fixed_words(text: str, note: str) -> None:
    logged = format_failure(ConnectionError(text))

    assert f"[{note}]" in logged
    assert "canary" not in logged


def test_a_message_with_no_known_words_is_withheld_with_no_note() -> None:
    logged = format_failure(ConnectionError("le serveur canary est parti"))

    assert "<message withheld>" in logged
    assert "canary" not in logged


def test_a_withheld_errno_and_a_tls_reason_are_kept() -> None:
    refused = ConnectionRefusedError(61, "connect canary-host")
    tls = ssl.SSLCertVerificationError(1, "certificate verify failed: canary-host")
    tls.reason = "CERTIFICATE_VERIFY_FAILED"

    assert "[ECONNREFUSED]" in format_failure(refused)
    assert "[TLS CERTIFICATE_VERIFY_FAILED]" in format_failure(tls)
    assert "canary" not in format_failure(refused) + format_failure(tls)


def test_text_we_fixed_stays_whatever_its_class() -> None:
    logged = format_failure(DependencyClosedError("postgres: the database is closed"))

    assert "postgres: the database is closed" in logged


def test_an_error_whose_attributes_misbehave_is_still_described() -> None:
    class Hostile(ConnectionError):
        @property
        def sqlstate(self) -> str:
            raise RuntimeError("no")

    assert "<message withheld>" in format_failure(Hostile("names canary"))


def test_a_failed_connect_to_a_name_with_several_addresses_keeps_them_out_of_the_log() -> None:
    """Asyncio raises a plain ``OSError``, with no errno, naming every address it tried."""
    tried = OSError(
        "Multiple exceptions: [Errno 61] Connect call failed ('::1', 5, 0, 0), "
        "[Errno 61] Connect call failed ('10.9.8.7', 5)"
    )

    logged = format_failure(_raise_wrapped(tried, "connecting failed"))

    assert "10.9.8.7" not in logged
    assert "[ECONNREFUSED]" in logged


def test_the_path_of_a_failed_file_operation_stays_out_of_the_log() -> None:
    logged = format_failure(FileNotFoundError(2, "No such file", "/canary/path"))

    assert "/canary/path" not in logged
    assert "[ENOENT]" in logged
