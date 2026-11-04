# Architecture: FastAPI

These rules govern all new code in this project. It is organised by module, with the same layers and the same envelope as the Node backends. A module directory keeps everything for one feature together, where a by-layer tree scatters one change across four folders.

## Layout

```text
src/
  main.py                  # create_app(): infra, middleware, handlers, routers, lifespan; serves when run directly
  infra/                   # the seam: create_infra(config), types.py, settings.py; what the process depends on
  core/
    config.py              # pydantic-settings; Settings extends infra.settings.InfraSettings
    errors.py              # FAILURES table and ApiError
    envelope.py            # success, listing, failure and the response models
    handlers.py            # exception handlers
    middleware.py          # request id and access log
    rate_limit.py          # per-client request limit (the limits package behind a middleware)
    logging.py             # loguru setup
    paging.py              # page_params and MAX_PAGE_SIZE
    dependency.py          # is_dependency_outage
    dependency_checks.py   # DependencyCheck, HealthProbe and the startup gate
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

`core/config.py` holds one `BaseSettings` class, read once at boot; an invalid or missing required value stops the process before it serves, naming the field and never its value (`hide_input_in_errors`). A field has a development default unless it names a service the server cannot run without (`data.md`, Dependencies); the connection settings of a store are declared in `infra/settings.py`, whose `InfraSettings` class `Settings` extends. Add a field when code reads it, and add it to `.env.example` with a fake value; the tests run with the values of that file, so a required field left out fails them. The server listens on port 8000 by default.

## Router and dependencies

- A router function parses input through its schema, calls one service function, and returns the envelope helper's result. No query, no business rule.
- Declare `response_model=Envelope[Model]` (or `ListEnvelope[Model]`) so the schema comes from the same pydantic models as the wire.
- Authentication is not shipped (see `api-and-errors.md`, Auth). When added it is mounted once, at the app, as `FastAPI(dependencies=[Depends(current_user)])`, and a public route opts out with an explicit marker.
- The interactive docs and the OpenAPI document are switched off. Anything added with `app.mount` or `add_route` bypasses app-level dependencies, so mount nothing outside the routers.

## Extension

Capabilities are added through ports and `create_xxx(deps)` factories, connected at one wiring place. See `extending.md`; `hello` is the model.

## The infrastructure seam

`src/infra/` is the one place that knows what the process depends on. `create_infra(config)` returns an `Infra` with the dependency checks, an optional shared storage for the rate limit and a close function; `create_app` passes the checks to the `HealthProbe` behind the health route, the storage to `RateLimitMiddleware`, and runs the checks and the close in its lifespan. A project with no store returns no checks, no storage and a close that does nothing, so it starts as the base does. A data overlay replaces `infra/infra.py` and `infra/settings.py`, and nothing else changes.

- Startup: the lifespan runs every check under `bounded()` before it yields, so a failure stops the start before the server listens: uvicorn exits non-zero (3) naming the check and never a value.
- A dependency lost after startup answers 503 through `is_dependency_outage`; the process stays up. A limiter storage that cannot be reached answers the 503 failure envelope, because `RateLimitMiddleware` sits outside the exception handlers and answers it itself.
- Factories connect on first use, so building the real seam touches no service at import.
- Tests: `tests/conftest.py` replaces `main.create_infra` with a seam that has no checks and no storage in an autouse fixture, because tests call `create_app` themselves and `TestClient` runs the lifespan.

## Errors and logging

- `core/errors.py` holds `FAILURES` and `ApiError(code, name=None)`; `core/envelope.py` holds `success`, `listing` and `failure`. The handlers registered by `create_app` turn `ApiError`, `RequestValidationError`, `HTTPException` and any unexpected exception into the failure envelope, per `api-and-errors.md`.
- loguru is configured once in `core/logging.py` and writes to stdout; standard-library records (uvicorn, libraries) are routed into it. Log the cause chain of unexpected errors, and never a secret, token or full request body. Tracebacks never include variable values.
- The access log records the route pattern, never the concrete URL.

## Data access

The rules are in `data.md`: the service opens the transaction and passes the handle to the repository, and queries live only in repositories. A store's own page adds what is specific to it.

## Tests

- Tests sit in top-level `tests/<module>/test_*.py`, mirroring `src/`, and run once with `make test`, which needs no service. Tests that need a real store live in `tests_integration/` and run through their own target.
- `tests/conftest.py` puts the fake settings of `.env.example` in the environment before `main` is imported, builds a fresh application with `create_app()` and a `TestClient(raise_server_exceptions=False)`, so an unexpected error is answered like a server answers it instead of re-raised. A test that needs a route which fails on purpose adds a test-only router to that application. A test that needs another setting passes its own, `create_app(Settings(_env_file=None, rate_limit_max=2))`.
- Test the service against a real store; stub only external services.
- Guard the contract of each route (status and envelope) and every risky path; one regression test per real bug.

## Adding a module

1. Create `src/<module>/` with `router.py`, `schemas.py` and `service.py`, and `tests/<module>/`.
2. Define ports and factories as in `extending.md`, wire them in the module's `dependencies.py`, and include the router in `create_app` with `prefix=API_PREFIX`.
3. Services raise `ApiError` with a table code; routers return `success(...)` or `listing(...)`.
4. Update the docs listed in `docs-to-update.md` in the same change.
