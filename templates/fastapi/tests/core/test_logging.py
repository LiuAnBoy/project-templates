import asyncio
import errno
import logging

import pytest

from core.logging import configure_logging, log_stray_failure


def test_a_driver_record_keeps_its_sentence_and_loses_its_arguments(
    capsys: pytest.CaptureFixture[str],
) -> None:
    configure_logging("INFO")

    logging.getLogger("psycopg").warning(
        "query cancellation failed: %s", 'connection to server at "canary-host" failed'
    )

    out = capsys.readouterr().out
    assert "query cancellation failed: <withheld>" in out
    assert "canary-host" not in out


def test_another_library_keeps_its_arguments(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("INFO")

    logging.getLogger("uvicorn.error").info("Started server process [%d]", 7)

    assert "Started server process [7]" in capsys.readouterr().out


def test_an_error_logged_as_the_message_is_described_without_its_text(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """As uvicorn does with a failed bind, which quotes the address it was told to use."""
    configure_logging("INFO")
    error = OSError(errno.EADDRINUSE, "error while attempting to bind on address ('canary', 1)")

    logging.getLogger("uvicorn.error").error(error)

    out = capsys.readouterr().out
    assert "EADDRINUSE" in out
    assert "canary" not in out


def test_a_task_that_failed_unseen_is_logged_without_its_text(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """The loop's default handler prints the task's repr, which quotes the error."""
    configure_logging("INFO")

    async def run() -> None:
        loop = asyncio.get_running_loop()
        loop.set_exception_handler(log_stray_failure)
        error = ConnectionError('connection to server at "canary-host" failed')
        loop.call_exception_handler(
            {"message": "Task exception was never retrieved", "exception": error}
        )

    asyncio.run(run())

    out = capsys.readouterr().out
    assert "Task exception was never retrieved" in out
    assert "ConnectionError" in out
    assert "canary-host" not in out
