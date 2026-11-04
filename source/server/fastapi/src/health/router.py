"""The health probe, outside ``/api/v1`` and outside the envelope."""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from core.dependency_checks import HealthProbe

#: The path of the health route.
HEALTH_PATH = "/api/health"

router = APIRouter(tags=["health"])


@router.get(HEALTH_PATH)
async def get_health(request: Request) -> JSONResponse:
    """Answer the health probe.

    Envelope exception: a probe answers a bare status so a load balancer can read
    it, so this route does not call ``success()``. It is public and stays public
    when authentication is added, and ``create_app`` exempts it from the rate
    limit: a probe answered 429 reads as a dead service. It runs the dependency
    checks through one shared probe, kept on ``app.state``: concurrent requests
    share one run and its result is reused for a second, because an exempt route
    must not cost a store round trip per request. All passing, or no checks at
    all, answers 200 ``{"status":"ok"}``; any failure answers 503
    ``{"status":"unavailable"}`` with no check name in the body, and the log
    names it.

    Args:
        request: The request, for the application's probe.

    Returns:
        The bare status body.
    """
    probe: HealthProbe = request.app.state.health_probe
    if await probe():
        return JSONResponse({"status": "ok"})
    return JSONResponse({"status": "unavailable"}, status_code=503)
