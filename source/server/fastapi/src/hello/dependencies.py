"""The wiring place of the hello module: which implementation backs each port.

This file and ``main.py`` are the only places that know which implementation is
in use. To swap or add one, write its ``create_xxx`` factory and change the one
line in :func:`get_greeter`. Tests replace a provider with
``app.dependency_overrides``.
"""

from typing import Annotated

from fastapi import Depends

from hello.greeter import Greeter, create_static_greeter
from hello.service import HelloService, create_hello_service


def get_greeter() -> Greeter:
    """Pick the ``Greeter`` implementation.

    Returns:
        The greeter the module uses.
    """
    return create_static_greeter()


def get_hello_service(greeter: Annotated[Greeter, Depends(get_greeter)]) -> HelloService:
    """Build the hello service from its port.

    Args:
        greeter: The greeter chosen by :func:`get_greeter`.

    Returns:
        The service.
    """
    return create_hello_service(greeter)
