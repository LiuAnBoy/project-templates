## Stack

Stack: NestJS 11 on Fastify, zod validation (nestjs-zod), nestjs-pino, dayjs behind `src/common/date.ts`, Vitest, ESLint 10 and Prettier, pnpm. No database yet; when one is needed: PostgreSQL through Drizzle with migrations generated from its schema (`docs/rules/postgres.md`).

This is a starter with one public route, `GET /api/v1/hello`, built on the shared handlers (envelope, failure table, exception filter, request id, access log). Add modules on top of them; do not rewrite them.

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
