import pytest
from fastapi.testclient import TestClient

from core.config import Settings
from core.rate_limit import client_key, parse_trusted_proxies
from main import create_app

TOO_MANY = '{"success":false,"payload":{"message":"too many requests"}}'
PROXY = ("10.1.1.1", 50000)


def _client(**values: object) -> TestClient:
    """A client whose socket address is ``PROXY``, on an app with these settings."""
    app = create_app(Settings(_env_file=None, **values))  # type: ignore[arg-type]
    return TestClient(app, client=PROXY)


def test_a_request_under_the_limit_is_untouched() -> None:
    response = _client(rate_limit_max=2).get("/api/v1/hello")

    assert response.status_code == 200
    assert response.text == '{"success":true,"payload":{"data":{"message":"hello world!!"}}}'


def test_the_request_past_the_limit_answers_the_exact_failure_envelope() -> None:
    client = _client(rate_limit_max=2)

    client.get("/api/v1/hello")
    client.get("/api/v1/hello")
    response = client.get("/api/v1/hello")

    assert response.status_code == 429
    assert response.text == TOO_MANY
    assert int(response.headers["retry-after"]) >= 1
    assert response.headers["x-request-id"]


def test_the_defaults_are_300_requests_per_60_seconds() -> None:
    client = _client()

    for _ in range(300):
        assert client.get("/api/v1/hello").status_code == 200
    assert client.get("/api/v1/hello").status_code == 429


def test_a_changed_setting_takes_effect_and_every_route_shares_one_count() -> None:
    client = _client(rate_limit_max=1, rate_limit_window_seconds=30)

    assert client.get("/api/v1/hello").status_code == 200
    assert client.get("/api/v1/not-a-route").status_code == 429


def test_a_forged_forwarded_header_earns_no_new_bucket_when_no_proxy_is_trusted() -> None:
    client = _client(rate_limit_max=2)

    client.get("/api/v1/hello", headers={"x-forwarded-for": "1.1.1.1"})
    client.get("/api/v1/hello", headers={"x-forwarded-for": "2.2.2.2"})
    response = client.get("/api/v1/hello", headers={"x-forwarded-for": "3.3.3.3"})

    assert response.status_code == 429
    assert response.text == TOO_MANY


def test_the_forwarded_address_counts_once_its_proxy_is_trusted() -> None:
    client = _client(rate_limit_max=1, trust_proxy="10.1.1.1")

    assert client.get("/api/v1/hello", headers={"x-forwarded-for": "1.1.1.1"}).status_code == 200
    assert client.get("/api/v1/hello", headers={"x-forwarded-for": "2.2.2.2"}).status_code == 200
    assert client.get("/api/v1/hello", headers={"x-forwarded-for": "1.1.1.1"}).status_code == 429


def test_an_address_the_client_prepended_does_not_count() -> None:
    client = _client(rate_limit_max=1, trust_proxy="10.1.1.1")

    first = client.get("/api/v1/hello", headers={"x-forwarded-for": "9.9.9.9, 1.1.1.1"})
    second = client.get("/api/v1/hello", headers={"x-forwarded-for": "8.8.8.8, 1.1.1.1"})

    assert first.status_code == 200
    assert second.status_code == 429


def test_the_forwarded_header_is_ignored_from_an_address_that_is_not_a_trusted_proxy() -> None:
    client = _client(rate_limit_max=1, trust_proxy="10.9.9.9")

    assert client.get("/api/v1/hello", headers={"x-forwarded-for": "1.1.1.1"}).status_code == 200
    assert client.get("/api/v1/hello", headers={"x-forwarded-for": "2.2.2.2"}).status_code == 429


@pytest.mark.parametrize("value", ["true", "*", "1", "0.0.0.0/0", "::/0", "10.0.0.1,*", "nope"])
def test_a_blanket_or_malformed_trust_proxy_is_refused(value: str) -> None:
    with pytest.raises(ValueError):
        parse_trusted_proxies(value)
    with pytest.raises(ValueError):
        Settings(_env_file=None, trust_proxy=value)


def test_trust_proxy_reads_addresses_ranges_and_named_ranges() -> None:
    assert parse_trusted_proxies("") == ()
    assert parse_trusted_proxies("false") == ()
    assert len(parse_trusted_proxies("10.0.0.1, 192.168.0.0/16, loopback")) == 4


def test_an_ipv4_proxy_seen_as_a_mapped_address_is_still_trusted() -> None:
    trusted = parse_trusted_proxies("10.1.1.1")
    scope = {
        "client": ("::ffff:10.1.1.1", 1),
        "headers": [(b"x-forwarded-for", b"1.1.1.1")],
    }

    assert client_key(scope, trusted) == "1.1.1.1"


def test_addresses_of_one_ipv6_network_share_a_bucket_and_a_mapped_ipv4_is_ipv4() -> None:
    def key(address: str) -> str:
        return client_key({"client": (address, 1), "headers": []}, ())

    assert key("2001:db8::1") == key("2001:db8::ffff")
    assert key("2001:db8::1") != key("2001:db9::1")
    assert key("::ffff:1.2.3.4") == key("1.2.3.4")
