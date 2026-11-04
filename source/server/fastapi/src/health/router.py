"""The liveness probe, outside ``/api/v1`` and outside the envelope."""

from fastapi import APIRouter

#: The path of the liveness route.
HEALTH_PATH = "/api/health"

router = APIRouter(tags=["health"])


@router.get(HEALTH_PATH)
async def get_health() -> dict[str, str]:
    """Answer the liveness probe.

    Envelope exception: a probe answers a bare status so a load balancer can read
    it, so this route does not call ``success()``. It is public and stays public
    when authentication is added, and ``create_app`` exempts it from the rate
    limit: a probe answered 429 reads as a dead service. It touches no dependency,
    because none ships; a data overlay adds its checks and answers 503
    ``{"status": "unavailable"}`` when one is down.

    Returns:
        The bare liveness body.
    """
    return {"status": "ok"}
