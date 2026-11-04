"""Page arithmetic shared by every list route."""

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Query

#: The largest page a list may ask for.
MAX_PAGE_SIZE = 100


@dataclass(frozen=True)
class Page:
    """A resolved page request.

    Attributes:
        page: The page served, starting at 1.
        page_size: The effective page size, after clamping to ``MAX_PAGE_SIZE``.
    """

    page: int
    page_size: int

    @property
    def offset(self) -> int:
        """How many rows come before this page.

        Returns:
            ``(page - 1) * page_size``.
        """
        return (self.page - 1) * self.page_size


def page_params(
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1)] = 20,
) -> Page:
    """Read the paging query parameters; ``page_size`` is clamped, not rejected.

    Args:
        page: The page number, starting at 1.
        page_size: The requested page size.

    Returns:
        The page with the effective size.
    """
    return Page(page=page, page_size=min(page_size, MAX_PAGE_SIZE))


#: Declare ``page: PageDep`` in a list route to receive the resolved page.
PageDep = Annotated[Page, Depends(page_params)]
