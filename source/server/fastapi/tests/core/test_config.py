import pytest
from pydantic import ValidationError

from core.config import Settings


def test_an_invalid_setting_message_holds_no_value() -> None:
    with pytest.raises(ValidationError) as raised:
        Settings(_env_file=None, log_level="value-that-may-be-a-secret")  # type: ignore[arg-type]

    assert "value-that-may-be-a-secret" not in str(raised.value)
