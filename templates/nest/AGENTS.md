# NestJS server

Stack: NestJS 11 on Fastify, zod validation (nestjs-zod), nestjs-pino, Vitest, ESLint 10 and Prettier, pnpm. No database yet; when one is needed: PostgreSQL, hand-written SQL migrations run by `db/migrate.sh`, no ORM owning the schema.

This is a starter with one public route, `GET /api/v1/hello`, built on the shared handlers (envelope, failure table, exception filter, request id, access log). Add modules on top of them; do not rewrite them.

## Always

- New backend capabilities are developed through ports and `createXxx(deps)` factories, wired in one place; this is required, not optional (`docs/rules/extending.md`).
- Layers: controller, then service, then repository. Cross-module calls go service to service, never to another module's repository. A controller handles HTTP only.
- Validate at the edge with zod (environment, request and response DTOs). Do not use class-validator.
- Every answer uses the one response envelope. Controllers return plain data or `paginated(...)`; only `ResponseEnvelopeInterceptor` builds a success body and only `AllExceptionsFilter` builds a failure body. Lists are always paged.
- Services throw `AppError` with a code from the failure table in `src/common/errors/failures.ts`; the code is never serialised. A new failure is a new table entry plus a line in the API page.
- Auth: this template ships no authentication. Every route it has is public. Before any non-public route ships, add a global guard (`APP_GUARD`) with an explicit `@Public()` opt-out; the steps are in `docs/rules/api-and-errors.md` (Auth). Never describe this service as protected until those steps are done.
- SQL lives only in repositories; the service owns the transaction scope. PostgreSQL by default (`docs/rules/postgres.md`).
- Dependency calls on the request path are wrapped in `bounded()`; an unreachable dependency answers 503, not 500.
- The server listens on port 8000 and boots with no `.env` and an empty environment. Add an environment variable only when code reads it, in `src/config/env.ts`, with a fake value in `.env.example`.
- Imports use the `.js` extension (ESM). Tests live in the owning folder's `tests/`.
- Comments and docstrings are English; JSDoc (`/** ... */`) on functions, classes and modules, with `@param`, `@returns`, `@throws` as applicable.
- An API or schema change updates the docs in the same change (`docs/rules/docs-to-update.md`).

## Commands

`pnpm dev`, `pnpm build`, `pnpm start`, `pnpm lint`, `pnpm format:check` (`pnpm format` rewrites), `pnpm typecheck`, `pnpm test` (single run). A change is done when lint, format:check, typecheck, test and build pass.

## Task to doc

| Task                                                                                     | Read                           |
| ---------------------------------------------------------------------------------------- | ------------------------------ |
| Any answer, error, status code, auth                                                     | `docs/rules/api-and-errors.md` |
| Module, controller, DTO, env, wiring, tests                                              | `docs/rules/architecture.md`   |
| Schema, migration, query layer, transactions                                             | `docs/rules/postgres.md`       |
| Cache, lock, pub/sub, queue                                                              | `docs/rules/redis.md`          |
| Permissions, duplicates and races, audit, scheduled work, growing tables, trust, outages | `docs/rules/patterns.md`       |
| Which doc a change must update                                                           | `docs/rules/docs-to-update.md` |
| How a request flows, commands, environment variables                                     | `docs/README.md`               |
| Endpoints and their shapes                                                               | `docs/api/README.md`           |
| Tables                                                                                   | `docs/database.md`             |

## Standard flow for adding a feature

1. Read this file, then the rules the table names for the task.
2. Required for every new capability: extend through ports and `createXxx(deps)` factories wired in one place (`docs/rules/extending.md`). Copy the shape of `src/modules/hello/`: a module, a controller returning plain data, a service, a DTO built from a zod schema, and a `tests/` folder. Register the module in `src/app.module.ts`.
3. Throw `AppError` for every failure the client may see; add table entries where needed.
4. Write the tests: the envelope of each route and each failure path.
5. Record it in the Traditional Chinese docs: the endpoint in `docs/api/README.md` and its own page, tables in `docs/database.md`, the module in `docs/README.md`.
6. Run the commands above and fix what fails.

## Documents

- `AGENTS.md` and everything under `docs/rules/` are English with no CJK characters. They are the rules.
- Every other page under `docs/` (`README.md`, `api/`, `database.md`, and any page added later) is Traditional Chinese. These are records of what exists.
- Records state only what exists: the endpoint index lists the endpoints that ship, the database page lists the tables that exist (none yet), nothing planned.
- Relative links must resolve.
- `docs/rules/` govern all new code. Where code and a rule disagree, fix the code or change the rule in the same change; do not let them drift.
