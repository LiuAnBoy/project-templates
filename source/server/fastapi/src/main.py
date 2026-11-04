"""Application entry point: build the app and, when run directly, serve it."""

import uvicorn
from fastapi import FastAPI

from core.config import Settings, settings
from core.handlers import register_handlers
from core.logging import configure_logging
from core.middleware import RequestContextMiddleware
from core.rate_limit import RateLimitMiddleware, create_memory_storage, parse_trusted_proxies
from health.router import HEALTH_PATH
from health.router import router as health_router
from hello.router import router as hello_router

#: The prefix of every route.
API_PREFIX = "/api/v1"


def create_app(config: Settings = settings) -> FastAPI:
    """Build the application.

    Everything the process needs is registered here and nowhere else, so a test
    boots exactly what the server boots. The interactive docs and the OpenAPI
    document are switched off. This function and each module's ``dependencies.py``
    are the wiring places: a new module is one ``include_router`` line here.
    The request limit is wired here: ``create_memory_storage()`` is the port's
    implementation, replaced by one shared across instances when there is more than
    one. This template ships no authentication, so every route is public;
    add an app-level dependency before the first route that must not be.

    Args:
        config: The process configuration; tests pass their own.

    Returns:
        The configured application.
    """
    configure_logging(config.log_level)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    # The last middleware added is the outermost: the request context wraps the
    # limit, so a refused request still gets an id and an access log line.
    app.add_middleware(
        RateLimitMiddleware,
        storage=create_memory_storage(),
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
