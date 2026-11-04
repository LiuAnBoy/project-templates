import pytest

from core.registry import Registry, create_registry


def test_registry_returns_what_was_registered_in_order() -> None:
    registry: Registry[str] = create_registry()
    registry.register("a", "first")
    registry.register("b", "second")

    assert registry.get("b") == "second"
    assert registry.all() == ["first", "second"]


def test_registry_rejects_a_duplicate_key_and_an_unknown_key() -> None:
    registry: Registry[str] = create_registry()
    registry.register("a", "first")

    with pytest.raises(ValueError, match="already registered: a"):
        registry.register("a", "again")
    with pytest.raises(KeyError):
        registry.get("missing")
