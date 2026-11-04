"""A keyed collection of implementations of one port."""


class Registry[T]:
    """Holds the several implementations of one port (sources, channels, providers).

    Registering a duplicate key raises, so two implementations can never silently
    shadow each other; getting an unknown key raises, so a mistake shows at boot.
    """

    def __init__(self) -> None:
        """Create an empty registry."""
        self._items: dict[str, T] = {}

    def register(self, key: str, value: T) -> None:
        """Add an implementation under a key.

        Args:
            key: The unique name of the implementation.
            value: The implementation.

        Raises:
            ValueError: When the key is already registered.
        """
        if key in self._items:
            raise ValueError(f"already registered: {key}")
        self._items[key] = value

    def get(self, key: str) -> T:
        """Look an implementation up.

        Args:
            key: The name it was registered under.

        Returns:
            The implementation.

        Raises:
            KeyError: When nothing is registered under the key.
        """
        if key not in self._items:
            raise KeyError(f"not registered: {key}")
        return self._items[key]

    def all(self) -> list[T]:
        """List every implementation, in registration order.

        Returns:
            The implementations.
        """
        return list(self._items.values())


def create_registry[T]() -> Registry[T]:
    """Create an empty registry.

    Returns:
        A registry for one port.
    """
    return Registry[T]()
