# Architecture: FastAPI

These rules govern all new code in this project. It is organised by module, with the same layers and the same envelope as the Node backends. A module directory keeps everything for one feature together, where a by-layer tree scatters one change across four folders.

## Layout

```text
src/
  main.py                  # create_app(): middleware, handlers, routers; serves when run directly
  core/
    config.py              # pydantic-settings
    errors.py              # FAILURES table and ApiError
    envelope.py            # success, listing, failure and the response models
    handlers.py            # exception handlers
    middleware.py          # request id and access log
    rate_limit.py          # per-client request limit (the limits package behind a middleware)
    logging.py             # loguru setup
    paging.py              # page_params and MAX_PAGE_SIZE
    dependency.py          # is_dependency_outage
    registry.py            # create_registry()
    bounded.py             # deadline for dependency calls
  <module>/
    router.py              # HTTP only: parse, call the service, wrap the answer
    schemas.py             # request and response pydantic models
    service.py             # business rules and the transaction scope
    <port>.py              # Protocol ports and their create_xxx factories
    dependencies.py        # wiring place: which implementation backs each port
tests/<module>/test_*.py
tests/conftest.py
```

`repository.py`, `rows.py`, `exceptions.py` and `constants.py` join a module when it first needs them: a file exists when it holds code.

Tooling: uv (dependencies, `uv run`), ruff (lint and format, Google-style docstrings enforced), pytest. The Makefile has `dev`, `start`, `lint`, `format`, `format-check` and `test`.

## Imports run one way

Router to service to repository, and `core/` is imported by everyone and imports no module. A service may call another module's service, never its repository. Another module's table is its own business, reachable only through its rules.

## Config

`core/config.py` holds one `BaseSettings` class, read once at boot; an invalid value stops the process before it serves. Every field has a development default, so the server boots with no `.env`. Add a field when code reads it, and add it to `.env.example` with a fake value. The server listens on port 8000 by default.

## Router and dependencies

- A router function parses input through its schema, calls one service function, and returns the envelope helper's result. No SQL, no business rule.
- Declare `response_model=Envelope[Model]` (or `ListEnvelope[Model]`) so the schema comes from the same pydantic models as the wire.
- Authentication is not shipped (see `api-and-errors.md`, Auth). When added it is mounted once, at the app, as `FastAPI(dependencies=[Depends(current_user)])`, and a public route opts out with an explicit marker.
- The interactive docs and the OpenAPI document are switched off. Anything added with `app.mount` or `add_route` bypasses app-level dependencies, so mount nothing outside the routers.

## Extension

Capabilities are added through ports and `create_xxx(deps)` factories, connected at one wiring place. See `extending.md`; `hello` is the model.

## Errors and logging

- `core/errors.py` holds `FAILURES` and `ApiError(code, name=None)`; `core/envelope.py` holds `success`, `listing` and `failure`. The handlers registered by `create_app` turn `ApiError`, `RequestValidationError`, `HTTPException` and any unexpected exception into the failure envelope, per `api-and-errors.md`.
- loguru is configured once in `core/logging.py` and writes to stdout; standard-library records (uvicorn, libraries) are routed into it. Log the cause chain of unexpected errors, and never a secret, token or full request body. Tracebacks never include variable values.
- The access log records the route pattern, never the concrete URL.

## Data access

This template ships no database. When one is added, follow `postgres.md`: the service opens the transaction and passes the connection to the repository, and SQL lives only in repositories.

## Tests

- Tests sit in top-level `tests/<module>/test_*.py`, mirroring `src/`, and run once with `make test`.
- `tests/conftest.py` builds a fresh application with `create_app()` and a `TestClient(raise_server_exceptions=False)`, so an unexpected error is answered like a server answers it instead of re-raised. A test that needs a route which fails on purpose adds a test-only router to that application. A test that needs another setting passes its own, `create_app(Settings(_env_file=None, rate_limit_max=2))`.
- Test the service against a real database; stub only external services.
- Guard the contract of each route (status and envelope) and every risky path; one regression test per real bug.

## Adding a module

1. Create `src/<module>/` with `router.py`, `schemas.py` and `service.py`, and `tests/<module>/`.
2. Define ports and factories as in `extending.md`, wire them in the module's `dependencies.py`, and include the router in `create_app` with `prefix=API_PREFIX`.
3. Services raise `ApiError` with a table code; routers return `success(...)` or `listing(...)`.
4. Update the docs listed in `docs-to-update.md` in the same change.
