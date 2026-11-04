"""Business flow of the hello module."""

from hello.greeter import Greeter
from hello.schemas import HelloData


class HelloService:
    """Builds the hello answer from the ``Greeter`` port.

    A real service holds the business rules and owns the transaction scope.
    """

    def __init__(self, greeter: Greeter) -> None:
        """Create the service.

        Args:
            greeter: The port the greeting comes from.
        """
        self._greeter = greeter

    def get_hello(self) -> HelloData:
        """Build the greeting.

        Returns:
            The data of the hello route.
        """
        return HelloData(message=self._greeter.greet())


def create_hello_service(greeter: Greeter) -> HelloService:
    """Create the hello service.

    Args:
        greeter: The port the greeting comes from.

    Returns:
        The service.
    """
    return HelloService(greeter)
