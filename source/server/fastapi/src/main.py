"""Application entry point: build the app and, when run directly, serve it."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from loguru import logger

from core.config import Settings, settings
from core.dependency_checks import HealthProbe, run_startup_checks
from core.handlers import register_handlers
from core.logging import configure_logging
from core.middleware import RequestContextMiddleware
from core.rate_limit import RateLimitMiddleware, create_memory_storage, parse_trusted_proxies
from health.router import HEALTH_PATH
from health.router import router as health_router
from hello.router import router as hello_router
from infra.infra import create_infra

#: The prefix of every route.
API_PREFIX = "/api/v1"


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
    infra = create_infra(config)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        """Gate the start on the dependency checks, and release the infra on shutdown.

        A failed check raises before the server listens, so uvicorn exits
        non-zero naming the check and never a value; a store lost after
        startup answers 503 and does not end the process.

        Args:
            _app: The application.

        Yields:
            Once the checks have passed.
        """
        try:
            await run_startup_checks(infra.checks)
        except BaseException:
            await infra.close()
            raise
        try:
            yield
        finally:
            await infra.close()

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
        # TRUST_PROXY is the one place that decides which forwarded address counts.
        proxy_headers=False,
    )
