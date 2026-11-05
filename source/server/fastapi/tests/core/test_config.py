import pytest
from pydantic import ValidationError

from core.config import Settings, load_settings


def test_an_invalid_setting_message_holds_no_value() -> None:
    with pytest.raises(ValidationError) as raised:
        Settings(_env_file=None, log_level="value-that-may-be-a-secret")  # type: ignore[arg-type]

    assert "value-that-may-be-a-secret" not in str(raised.value)


def test_a_malformed_setting_ends_the_process_with_one_line_naming_it(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("PORT", "canary-port")
    monkeypatch.setenv("RATE_LIMIT_MAX", "canary-max")

    with pytest.raises(SystemExit) as raised:
        load_settings()

    err = capsys.readouterr().err
    assert raised.value.code == 1
    assert err.strip() == "invalid configuration: PORT, RATE_LIMIT_MAX"


def test_a_port_out_of_range_is_refused() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, port=99999)  # type: ignore[arg-type]
