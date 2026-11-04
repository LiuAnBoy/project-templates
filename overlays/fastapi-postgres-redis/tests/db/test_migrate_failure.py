import asyncio
import io
import ssl

import pytest

from db.migrate import describe_migrate_failure, run_migrate, run_status

SECRETS = ("127.0.0.1", "secret-user", "secret-pw", "secret-db")


def _describe(url: str, monkeypatch: pytest.MonkeyPatch) -> str:
    """Run both commands against a URL that cannot be used; return what each would print."""
    monkeypatch.setenv("DATABASE_URL", url)
    texts = []
    for run in (run_migrate, run_status):
        try:
            asyncio.run(run(io.StringIO()))
        except Exception as error:
            texts.append(describe_migrate_failure(error))
        else:
            raise AssertionError("the command did not fail")
    assert texts[0] == texts[1]
    return texts[0]


def test_a_closed_port_prints_fixed_text_with_no_host_user_password_or_database(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    text = _describe("postgresql://secret-user:secret-pw@127.0.0.1:1/secret-db", monkeypatch)

    assert text.startswith("Cannot reach or open the database")
    for secret in SECRETS:
        assert secret not in text


def test_a_failed_tls_handshake_prints_no_host(monkeypatch: pytest.MonkeyPatch) -> None:
    async def attempt() -> str:
        async def refuse(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            await reader.readexactly(8)  # the SSLRequest
            writer.write(b"S")  # "go ahead", then no handshake at all
            await writer.drain()
            writer.close()

        server = await asyncio.start_server(refuse, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        monkeypatch.setenv(
            "DATABASE_URL",
            f"postgresql://secret-user:secret-pw@127.0.0.1:{port}/secret-db?sslmode=require",
        )
        try:
            await run_migrate(io.StringIO())
        except Exception as error:
            return describe_migrate_failure(error)
        finally:
            server.close()
        raise AssertionError("the command did not fail")

    text = asyncio.run(attempt())

    assert text.startswith("Cannot reach or open the database")
    for secret in SECRETS:
        assert secret not in text


def test_the_ssl_error_class_of_the_standard_library_is_a_connection_failure() -> None:
    text = describe_migrate_failure(ssl.SSLError(1, "certificate verify failed for secret-host"))

    assert "secret-host" not in text
    assert text.startswith("Cannot reach or open the database")


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://canaryuser:canarypw@127.0.0.1:CANARYPORT/canarydb",
        "postgresql://canaryuser:canarypw@127.0.0.1:1/canarydb?port=CANARYPORT",
        "postgresql://canaryuser:canarypw@[canary-host/canarydb",
        "postgresql://canaryuser:ca%ZZnarypw@127.0.0.1:1/canarydb",
    ],
)
def test_a_url_the_engine_cannot_be_built_from_is_refused_at_the_settings_naming_the_variable(
    url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    text = _describe(url, monkeypatch)

    assert "DATABASE_URL" in text
    assert "canary" not in text.lower()
    assert "CANARYPORT" not in text


@pytest.mark.parametrize("option", ["CANARYKEY=1", "canaryopt=CANARYVAL&CANARYKEY=1"])
def test_a_connection_option_the_driver_refuses_prints_fixed_text_with_no_address(
    option: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    text = _describe(f"postgresql://canaryuser:canarypw@localhost:1/canarydb?{option}", monkeypatch)

    assert text.startswith("Cannot reach or open the database")
    for canary in ("canary", "CANARY", "localhost", "::1", "127.0.0.1", "hostaddr", "port"):
        assert canary not in text.replace("Cannot reach or open the database", "")
