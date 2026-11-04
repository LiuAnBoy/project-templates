"""HTTP layer of the hello module: parse, call the service, wrap the answer."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends

from core.envelope import Envelope, success
from hello.dependencies import get_hello_service
from hello.schemas import HelloData
from hello.service import HelloService

router = APIRouter(prefix="/hello", tags=["hello"])


@router.get("", response_model=Envelope[HelloData])
async def get_hello(
    service: Annotated[HelloService, Depends(get_hello_service)],
) -> dict[str, Any]:
    """Answer the greeting.

    The route is public because the template ships no authentication.

    Args:
        service: The hello service, built from its port in ``hello/dependencies.py``.

    Returns:
        The success envelope with the greeting.
    """
    return success(service.get_hello())
