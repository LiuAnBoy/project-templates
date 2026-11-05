"""Application entry point: build the app and, when run directly, serve it."""

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from loguru import logger

from core.bounded import bounded
from core.config import Settings, settings
from core.dependency_checks import HealthProbe, run_startup_checks
from core.handlers import register_handlers
from core.logging import configure_logging, log_stray_failure
from core.middleware import RequestContextMiddleware
from core.rate_limit import RateLimitMiddleware, create_memory_storage, parse_trusted_proxies
from health.router import HEALTH_PATH
from health.router import router as health_router
from hello.router import router as hello_router
from infra.infra import create_infra
from infra.types import Infra

#: The prefix of every route.
API_PREFIX = "/api/v1"

#: How long closing what the process depends on may take, in seconds.
CLOSE_TIMEOUT_SECONDS = 2.0

#: How long a graceful shutdown waits for the requests in flight, in seconds. A request
#: waiting on a server that went silent never finishes on its own.
SHUTDOWN_DEADLINE_SECONDS = 10


async def _close_infra(close: Callable[[], Awaitable[None]]) -> None:
    """Release the infrastructure, under a deadline, and log a failure.

    A silent store cannot stop the process from ending, and an error raised from a
    lifespan is printed raw by the server, so it is logged here instead.

    Args:
        close: The close function of the seam.
    """
    try:
        await bounded(close(), CLOSE_TIMEOUT_SECONDS, "closing the infrastructure")
    except Exception as error:
        logger.opt(exception=error).error("closing the infrastructure failed")


def _build_infra(config: Settings) -> Infra:
    """Build the seam, keeping what its error quotes out of the traceback.

    A factory reads the settings, so its error can quote one. Nothing else is listening
    yet, and this traceback reaches the console unfiltered, so it names the class alone.

    Args:
        config: The process configuration.

    Returns:
        What the process depends on.

    Raises:
        RuntimeError: When a factory fails.
    """
    try:
        return create_infra(config)
    except Exception as error:
        raise RuntimeError(f"failed to build the infrastructure: {type(error).__name__}") from None


def create_app(config: Settings = settings) -> FastAPI:
    """Build the application.

    Everything the process needs is registered here and nowhere else, so a test
    boots exactly what the server boots. The interactive docs and the OpenAPI
    document are switched off. This function and each module's ``dependencies.py``
    are the wiring places: a new module is one ``include_router`` line here.
    What the process depends on comes from ``create_infra`` (``src/infra/``): its
    checks feed the health route and, in the lifespan, the gate that runs before
    the server listens; its shared storage, when it has one, takes the place of
    ``create_memory_storage()`` as the port of the request limit; its close runs
    on shutdown. This template ships no authentication, so every route is public;
    add an app-level dependency before the first route that must not be.

    Args:
        config: The process configuration; tests pass their own.

    Returns:
        The configured application.
    """
    configure_logging(config.log_level)
    infra = _build_infra(config)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        """Gate the start on the dependency checks, and release the infra on shutdown.

        A failed check raises before the server listens, so uvicorn exits
        non-zero naming the check and never a value; a store lost after
        startup answers 503 and does not end the process. What the event loop finds
        nobody handling is logged through ``core.failure``.

        Args:
            _app: The application.

        Yields:
            Once the checks have passed.
        """
        asyncio.get_running_loop().set_exception_handler(log_stray_failure)
        try:
            await run_startup_checks(infra.checks)
        except BaseException:
            await _close_infra(infra.close)
            raise
        try:
            yield
        finally:
            await _close_infra(infra.close)

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.health_probe = HealthProbe(
        infra.checks,
        on_failure=lambda names: logger.error(
            "dependency unavailable names={names}", names=", ".join(names)
        ),
    )
    # The last middleware added is the outermost: the request context wraps the
    # limit, so a refused request still gets an id and an access log line.
    app.add_middleware(
        RateLimitMiddleware,
        storage=infra.rate_limit_storage or create_memory_storage(),
        max_requests=config.rate_limit_max,
        window_seconds=config.rate_limit_window_seconds,
        trusted_proxies=parse_trusted_proxies(config.trust_proxy),
        exempt_paths={HEALTH_PATH},
    )
    app.add_middleware(RequestContextMiddleware)
    register_handlers(app)
    app.include_router(health_router)
    app.include_router(hello_router, prefix=API_PREFIX)
    return app


app = create_app()

if __name__ == "__main__":
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        log_config=None,
        access_log=False,
        timeout_graceful_shutdown=SHUTDOWN_DEADLINE_SECONDS,
        # TRUST_PROXY is the one place that decides which forwarded address counts.
        proxy_headers=False,
    )
