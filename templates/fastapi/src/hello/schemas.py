"""Request and response models of the hello module."""

from pydantic import BaseModel


class HelloData(BaseModel):
    """The ``data`` of ``GET /api/v1/hello``.

    Attributes:
        message: The greeting.
    """

    message: str
