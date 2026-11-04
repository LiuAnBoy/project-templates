# Backend server

## Always

- Database naming (`docs/rules/postgres.md`): tables and columns are snake_case, never camelCase; instants are `timestamptz`, never Unix integers; ids are `uuid` defaulting to `gen_random_uuid()`; every table has `id`, `created_at` and `updated_at`; no soft delete by default, a table that needs it adds `deleted_at`.
- SQL lives only in repositories; the service owns the transaction scope. PostgreSQL by default (`docs/rules/postgres.md`).
- Dependency calls on the request path are wrapped in `bounded()`; an unreachable dependency answers 503, not 500.
- An API or schema change updates the docs in the same change (`docs/rules/docs-to-update.md`).

## Task to doc

| Task                                                                                     | Read                           |
| ---------------------------------------------------------------------------------------- | ------------------------------ |
| Any answer, error, status code, auth                                                     | `docs/rules/api-and-errors.md` |
| Before writing any API code: the design of every route                                   | `docs/apis/conventions.md`     |
| Structure, configuration, wiring, tests                                                  | `docs/rules/architecture.md`   |
| Schema, migration, query layer, transactions                                             | `docs/rules/postgres.md`       |
| Cache, lock, pub/sub, queue                                                              | `docs/rules/redis.md`          |
| Permissions, duplicates and races, audit, scheduled work, growing tables, trust, outages | `docs/rules/patterns.md`       |
| Which doc a change must update                                                           | `docs/rules/docs-to-update.md` |
| How a request flows, commands, environment variables                                     | `docs/README.md`               |
| Endpoints and their shapes                                                               | `docs/apis/README.md`          |
| Tables                                                                                   | `docs/database.md`             |

## Documents

- `AGENTS.md` and everything under `docs/rules/` are English with no CJK characters. They are the rules.
- Every other page under `docs/` (`README.md`, `apis/`, `database.md`, and any page added later) is Traditional Chinese. These are records of what exists.
- Records state only what exists: the route index lists the routes that ship, the database page lists the tables that exist (none yet), nothing planned.
- Relative links must resolve.
- `docs/rules/` govern all new code. Where code and a rule disagree, fix the code or change the rule in the same change; do not let them drift.

## Stack

Stack: FastAPI on Python 3.12 or later, pydantic 2 and pydantic-settings, loguru, pytest, ruff, uv. No database yet; when one is needed: PostgreSQL through psycopg 3, hand-written SQL migrations run by `db/migrate.sh`, no ORM owning the schema.

This is a starter with one public route, `GET /api/v1/hello`, built on the shared handlers (envelope, failure table, exception handlers, request id, access log). Add modules on top of them; do not rewrite them.

## FastAPI rules

- New backend capabilities are developed through ports and `create_xxx(deps)` factories, wired in one place; this is required, not optional (`docs/rules/extending.md`).
- Layers: router, then service, then repository. `core/` is imported by everyone and imports no module. Cross-module calls go service to service, never to another module's repository. A router parses, calls one service function and returns the envelope helper's result.
- Validate at the edge with pydantic models (settings, request and response).
- Every answer uses the one response envelope. Routers return `success(...)` or `listing(...)` and declare `response_model=Envelope[...]`; only `core/handlers.py` builds a failure body. Lists are always paged.
- Wire format (`docs/rules/api-and-errors.md`): every wire key is snake_case, which Python code already is, so nothing is converted; ids are UUIDs, strings on the wire; instants are ISO 8601 strings; paths are plural kebab-case; `page_size` defaults to 20 and is capped at 100; failure messages are English.
- Services raise `ApiError` with a code from the failure table in `src/core/errors.py`; the code is never serialised. A new failure is a new table entry plus a row in the failure table of `docs/apis/conventions.md`.
- Auth: this template ships no authentication. Every route it has is public. Before any non-public route ships, add an app-level dependency (`FastAPI(dependencies=[Depends(current_user)])`) with an explicit `@public` opt-out; the steps are in `docs/rules/api-and-errors.md` (Auth). Never describe this service as protected until those steps are done.
- The server listens on port 8000 and boots with no `.env` and an empty environment. Add a setting only when code reads it, in `src/core/config.py`, with a fake value in `.env.example`.
- Tests live in top-level `tests/<module>/test_*.py`, mirroring `src/`.
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
