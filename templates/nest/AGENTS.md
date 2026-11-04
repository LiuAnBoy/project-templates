# Backend server

## Always

- Database naming (`docs/rules/postgres.md`): tables and columns are snake_case, never camelCase; instants are `timestamptz`, never Unix integers; ids are `uuid` defaulting to `gen_random_uuid()`; every table has `id`, `created_at` and `updated_at`; no soft delete by default, a table that needs it adds `deleted_at`.
- SQL lives only in repositories; the service owns the transaction scope. PostgreSQL by default (`docs/rules/postgres.md`).
- Dependency calls on the request path are wrapped in `bounded()`; an unreachable dependency answers 503, not 500.
- Rate limiting is on by default: 300 requests per client per 60 seconds (`RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS`), answered 429 from the failure table. The client is the socket address; a forwarded header counts only from the proxies listed in `TRUST_PROXY`, and nothing else reads that header to decide (`docs/rules/api-and-errors.md`, Rate limiting).
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

## Node conventions

- Dates go through `date` in `src/common/date.ts`, the only file that imports dayjs.
- Services throw `AppError` with a code from the failure table in `src/common/errors/failures.ts`; the code is never serialised. A new failure is a new table entry plus a row in the failure table of `docs/apis/conventions.md`.
- Wire format (`docs/rules/api-and-errors.md`): every wire key is snake_case while code stays camelCase, mapped field by field at the boundary with no generic key rewriter; ids are UUIDs, strings on the wire; instants are ISO 8601 strings; paths are plural kebab-case; `page_size` defaults to 20 and is capped at 100; failure messages are English.
- Imports use the `.js` extension (ESM). Tests live in the owning folder's `tests/`.
- Comments and docstrings are English; JSDoc (`/** ... */`) on functions, classes and modules, with `@param`, `@returns`, `@throws` as applicable.

## Commands

`pnpm dev`, `pnpm build`, `pnpm start`, `pnpm lint`, `pnpm format:check` (`pnpm format` rewrites), `pnpm typecheck`, `pnpm test` (single run). A change is done when lint, format:check, typecheck, test and build pass.

## Stack

Stack: NestJS 11 on Fastify, zod validation (nestjs-zod), nestjs-pino, dayjs behind `src/common/date.ts`, Vitest, ESLint 10 and Prettier, pnpm. No database yet; when one is needed: PostgreSQL through Drizzle with migrations generated from its schema (`docs/rules/postgres.md`).

This is a starter with two public routes, `GET /api/v1/hello` and the liveness probe `GET /api/health` (outside `/api/v1` and the envelope), built on the shared handlers (envelope, failure table, exception filter, request id, access log). Add modules on top of them; do not rewrite them.

## NestJS rules

- New backend capabilities are developed through ports and `createXxx(deps)` factories, wired in one place; this is required, not optional (`docs/rules/extending.md`).
- Layers: controller, then service, then repository. Cross-module calls go service to service, never to another module's repository. A controller handles HTTP only.
- Validate at the edge with zod (environment, request and response DTOs). Do not use class-validator.
- Every answer uses the one response envelope. Controllers return plain data or `paginated(...)`; only `ResponseEnvelopeInterceptor` builds a success body and only `AllExceptionsFilter` builds a failure body. Lists are always paged.
- Auth: this template ships no authentication. Every route it has is public. Before any non-public route ships, add a global guard (`APP_GUARD`) with an explicit `@Public()` opt-out; the steps are in `docs/rules/api-and-errors.md` (Auth). Never describe this service as protected until those steps are done.
- The server listens on port 8000 and boots with no `.env` and an empty environment. Add an environment variable only when code reads it, in `src/config/env.ts`, with a fake value in `.env.example`.

## Standard flow for adding a feature

1. Read this file, then the rules the table names for the task.
2. Required for every new capability: extend through ports and `createXxx(deps)` factories wired in one place (`docs/rules/extending.md`). Copy the shape of `src/modules/hello/`: a module, a controller returning plain data, a service, a DTO built from a zod schema, and a `tests/` folder. Register the module in `src/app.module.ts`.
3. Throw `AppError` for every failure the client may see; add table entries where needed.
4. Write the tests: the envelope of each route and each failure path.
5. Record it in the Traditional Chinese docs: the route in the index of `docs/apis/README.md` and in its own page under `docs/apis/`, tables in `docs/database.md`, the module in `docs/README.md`.
6. Run the commands above and fix what fails.
