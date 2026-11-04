"""The port the hello service depends on, and its implementations."""

from typing import Protocol


class Greeter(Protocol):
    """Where the greeting comes from."""

    def greet(self) -> str:
        """Produce the greeting.

        Returns:
            The greeting text.
        """
        ...


class _StaticGreeter:
    """A greeter that always answers the same text."""

    def greet(self) -> str:
        """Produce the greeting.

        Returns:
            The greeting text.
        """
        return "hello world!!"


def create_static_greeter() -> Greeter:
    """Create the greeter that always answers the same text.

    Other implementations (a configured text, a translated one) export their own
    ``create_xxx(deps)`` factory, take what they need as arguments and read no
    global settings; the wiring place chooses between them.

    Returns:
        A greeter.
    """
    return _StaticGreeter()
