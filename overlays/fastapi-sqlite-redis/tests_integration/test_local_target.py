import pytest
from local_target import require_local_url


def test_a_url_on_a_local_host_is_handed_out() -> None:
    for host in ("localhost", "127.0.0.1", "[::1]"):
        url = f"postgresql://u:p@{host}:5432/app"

        assert require_local_url("X", {"X": url}) == url


def test_a_host_that_is_not_local_is_refused_without_printing_the_url() -> None:
    url = "postgresql://u:secret-pw@db.example.com:5432/app"

    with pytest.raises(RuntimeError, match="not local") as raised:
        require_local_url("X", {"X": url})

    assert "secret-pw" not in str(raised.value)


@pytest.mark.parametrize("query", ["host=db.example.com", "hostaddr=10.0.0.5"])
def test_a_url_whose_query_overrides_the_host_is_refused(query: str) -> None:
    url = f"postgresql://u:secret-pw@localhost:5432/app?{query}"

    with pytest.raises(RuntimeError, match="host or hostaddr") as raised:
        require_local_url("X", {"X": url})

    assert "secret-pw" not in str(raised.value)


def test_a_missing_or_malformed_variable_fails() -> None:
    with pytest.raises(RuntimeError, match="X is required"):
        require_local_url("X", {})
    with pytest.raises(RuntimeError, match="not a URL"):
        require_local_url("X", {"X": "not a url"})
