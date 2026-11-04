"""Application entry point: build the app and, when run directly, serve it."""

import uvicorn
from fastapi import FastAPI

from core.config import settings
from core.handlers import register_handlers
from core.logging import configure_logging
from core.middleware import RequestContextMiddleware
from hello.router import router as hello_router

#: The prefix of every route.
API_PREFIX = "/api/v1"


def create_app() -> FastAPI:
    """Build the application.

    Everything the process needs is registered here and nowhere else, so a test
    boots exactly what the server boots. The interactive docs and the OpenAPI
    document are switched off. This function and each module's ``dependencies.py``
    are the wiring places: a new module is one ``include_router`` line here.
    This template ships no authentication, so every route is public;
    add an app-level dependency before the first route that must not be.

    Returns:
        The configured application.
    """
    configure_logging(settings.log_level)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(RequestContextMiddleware)
    register_handlers(app)
    app.include_router(hello_router, prefix=API_PREFIX)
    return app


app = create_app()

if __name__ == "__main__":
    uvicorn.run(app, host=settings.host, port=settings.port, log_config=None, access_log=False)
