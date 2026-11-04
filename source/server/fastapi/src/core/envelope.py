"""The response envelope: the one place an answer body is built.

Success: ``{"success": true, "payload": {"data": ...}}``. A list is always
paged, with the paging fields beside ``data`` in snake_case. Failure:
``{"success": false, "payload": {"message": "..."}}``. The keys are exactly
``success``, ``payload``, ``data``, ``page``, ``page_size``, ``total_count`` and
``message``.
"""

from typing import Any, Literal

from pydantic import BaseModel


class DataPayload[T](BaseModel):
    """The payload of a success.

    Attributes:
        data: The route's object, or its array.
    """

    data: T


class ListPayload[T](BaseModel):
    """The payload of a list: the page's rows and the paging fields beside them.

    Attributes:
        data: The rows of the requested page.
        page: The page number served, starting at 1.
        page_size: The effective page size, after clamping.
        total_count: How many rows match over all pages.
    """

    data: list[T]
    page: int
    page_size: int
    total_count: int


class FailurePayload(BaseModel):
    """The payload of a failure.

    Attributes:
        message: The fixed text of the failure.
    """

    message: str


class Envelope[T](BaseModel):
    """A success answer, declared as a route's ``response_model``.

    Attributes:
        success: Always true.
        payload: The payload holding ``data``.
    """

    success: Literal[True] = True
    payload: DataPayload[T]


class ListEnvelope[T](BaseModel):
    """A list answer, declared as a route's ``response_model``.

    Attributes:
        success: Always true.
        payload: The payload holding ``data`` and the paging fields.
    """

    success: Literal[True] = True
    payload: ListPayload[T]


class Failure(BaseModel):
    """A failure answer.

    Attributes:
        success: Always false.
        payload: The payload holding ``message``.
    """

    success: Literal[False] = False
    payload: FailurePayload


def success(data: Any = None) -> dict[str, Any]:
    """Wrap data in the success envelope.

    Args:
        data: What the route answers; ``None`` (a delete, say) becomes ``{}``.

    Returns:
        The envelope as a dict.
    """
    return {"success": True, "payload": {"data": {} if data is None else data}}


def listing(data: list[Any], *, page: int, page_size: int, total_count: int) -> dict[str, Any]:
    """Wrap one page of a list in the paged envelope.

    Args:
        data: The items on this page.
        page: The page served, starting at 1.
        page_size: The effective page size, after clamping.
        total_count: How many items match over all pages.

    Returns:
        The envelope as a dict.
    """
    return {
        "success": True,
        "payload": {
            "data": data,
            "page": page,
            "page_size": page_size,
            "total_count": total_count,
        },
    }


def failure(message: str) -> dict[str, Any]:
    """Build the failure envelope.

    Args:
        message: A fixed message from the failure table.

    Returns:
        The envelope as a dict.
    """
    return {"success": False, "payload": {"message": message}}
