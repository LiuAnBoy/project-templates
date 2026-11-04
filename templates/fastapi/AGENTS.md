# Backend server

## Always

- Data (`docs/rules/data.md`): tables and columns are snake_case, never camelCase; ids are UUIDs, strings on the wire; instants are ISO 8601 strings on the wire, never Unix integers; every table has `id`, `created_at` and `updated_at`; no soft delete by default. Queries live only in repositories, and the service owns the transaction scope.
- What the process depends on (a database, a cache) is created in `src/infra/` and nowhere else. Its dependency checks run before the server listens, and `GET /api/health` runs them too (`docs/rules/data.md`, Dependencies).
- Dependency calls on the request path are wrapped in `bounded()`; an unreachable dependency answers 503, not 500.
- Rate limiting is on by default: 300 requests per client per 60 seconds (`RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS`), answered 429 from the failure table. The client is the socket address; a forwarded header counts only from the proxies listed in `TRUST_PROXY`, and nothing else reads that header to decide (`docs/rules/api-and-errors.md`, Rate limiting).
- An API or schema change updates the docs in the same change (`docs/rules/docs-to-update.md`).

## Task to doc

| Task                                                                                     | Read                           |
| ---------------------------------------------------------------------------------------- | ------------------------------ |
| Any answer, error, status code, auth                                                     | `docs/rules/api-and-errors.md` |
| Before writing any API code: the design of every route                                   | `docs/apis/conventions.md`     |
| Structure, configuration, wiring, tests                                                  | `docs/rules/architecture.md`   |
| Schema, naming, query layer, transactions, dependencies                                  | `docs/rules/data.md`           |
| Permissions, duplicates and races, audit, scheduled work, growing tables, trust, outages | `docs/rules/patterns.md`       |
| Which doc a change must update                                                           | `docs/rules/docs-to-update.md` |
| How a request flows, commands, environment variables                                     | `docs/README.md`               |
| Endpoints and their shapes                                                               | `docs/apis/README.md`          |
| Tables                                                                                   | `docs/database.md`             |

## Documents

- `AGENTS.md` and everything under `docs/rules/` are English with no CJK characters. They are the rules.
- Every other page under `docs/` (`README.md`, `apis/`, `database.md`, and any page added later) is Traditional Chinese. These are records of what exists.
- Records state only what exists: the route index lists the routes that ship, the database page lists the tables that exist, nothing planned.
- Relative links must resolve.
- `docs/rules/` govern all new code. Where code and a rule disagree, fix the code or change the rule in the same change; do not let them drift.

## Stack

Stack: FastAPI on Python 3.12 or later, pydantic 2 and pydantic-settings, loguru, pytest, ruff, uv. Data rules, and the store when the project has one, are in `docs/rules/data.md`.

This is a starter with two public routes, `GET /api/v1/hello` and the health route `GET /api/health` (outside `/api/v1` and the envelope), built on the shared handlers (envelope, failure table, exception handlers, request id, access log) and the `src/infra/` seam that holds what the process depends on. Add modules on top of them; do not rewrite them.

## FastAPI rules

- New backend capabilities are developed through ports and `create_xxx(deps)` factories, wired in one place; this is required, not optional (`docs/rules/extending.md`).
- Layers: router, then service, then repository. `core/` is imported by everyone and imports no module. Cross-module calls go service to service, never to another module's repository. A router parses, calls one service function and returns the envelope helper's result.
- Validate at the edge with pydantic models (settings, request and response).
- Every answer uses the one response envelope. Routers return `success(...)` or `listing(...)` and declare `response_model=Envelope[...]`; only `core/handlers.py` builds a failure body. Lists are always paged.
- Wire format (`docs/rules/api-and-errors.md`): every wire key is snake_case, which Python code already is, so nothing is converted; ids are UUIDs, strings on the wire; instants are ISO 8601 strings; paths are plural kebab-case; `page_size` defaults to 20 and is capped at 100; failure messages are English.
- Services raise `ApiError` with a code from the failure table in `src/core/errors.py`; the code is never serialised. A new failure is a new table entry plus a row in the failure table of `docs/apis/conventions.md`.
- Auth: this template ships no authentication. Every route it has is public. Before any non-public route ships, add an app-level dependency (`FastAPI(dependencies=[Depends(current_user)])`) with an explicit `@public` opt-out; the steps are in `docs/rules/api-and-errors.md` (Auth). Never describe this service as protected until those steps are done.
- Add a setting only when code reads it, in `src/core/config.py`, with a fake value in `.env.example`; a setting that names a service the server cannot run without is declared in `src/infra/settings.py` and is required.
- Tests live in top-level `tests/<module>/test_*.py`, mirroring `src/`. `tests/conftest.py` loads the fake settings of `.env.example` and replaces `main.create_infra` with a seam that has no checks, so `make test` needs no service.
- Comments and docstrings are English; Google-style docstrings (`Args:`, `Returns:`, `Raises:`), enforced by ruff.

## Commands

`uv sync`, `make dev`, `make start`, `make lint`, `make format-check` (`make format` rewrites), `make test`. A change is done when lint, format-check and test pass.

## Standard flow for adding a feature

1. Read this file, then the rules the table names for the task.
2. Required for every new capability: extend through ports (`Protocol`) and `create_xxx(deps)` factories wired in one place (`docs/rules/extending.md`). Copy the shape of `src/hello/`: `router.py`, `service.py`, `schemas.py`, `greeter.py`, `dependencies.py` and `tests/<module>/`. Include the router in `create_app` in `src/main.py`.
3. Raise `ApiError` for every failure the client may see; add table entries where needed.
4. Write the tests: the envelope of each route and each failure path.
5. Record it in the Traditional Chinese docs: the route in the index of `docs/apis/README.md` and in its own page under `docs/apis/`, tables in `docs/database.md`, the module in `docs/README.md`.
6. Run the commands above and fix what fails.

## Data

No store is installed. The server boots with no `.env` and an empty environment, `docs/database.md` lists no tables, and `GET /api/health` runs no dependency check.

A store is chosen once, when the project is created, by extracting a data overlay over this template. The overlay brings its own rule page, its connection settings (required, validated at boot), its dependency checks in `src/infra/` and its documents. The naming and transaction rules in `docs/rules/data.md` apply from the first table on, whichever store it is.
