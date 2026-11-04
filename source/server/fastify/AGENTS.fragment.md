## Stack

Stack: Fastify 5, zod validation (fastify-type-provider-zod), pino, dayjs behind `src/common/date.ts`, Vitest, ESLint 10 and Prettier, pnpm. No database yet; when one is needed: PostgreSQL through Drizzle with migrations generated from its schema (`docs/rules/postgres.md`).

This is a starter with two public routes, `GET /api/v1/hello` and the liveness probe `GET /api/health` (outside `/api/v1` and the envelope), built on the shared handlers (envelope, failure table, error handler, request id, access log). Add domains on top of them; do not rewrite them.

## Fastify rules

- New backend capabilities are developed through ports and `createXxx(deps)` factories, wired in one place; this is required, not optional (`docs/rules/extending.md`).
- Layers: route, then service, then repository. Cross-domain calls go service to service, never to another domain's repository. A route parses, calls one service function and returns data.
- Validate at the edge with zod (environment, request and response schemas) through the type provider.
- Every answer uses the one response envelope. Routes return `success(...)` or `paginated(...)` and declare `successEnvelope(...)` or `pagedEnvelope(...)` as the response schema; only `registerErrorHandling` builds a failure body. Lists are always paged.
- Auth: this template ships no authentication. Every route it has is public. Before any non-public route ships, add an `onRequest` hook on the root instance with an explicit `config: { public: true }` opt-out; the steps are in `docs/rules/api-and-errors.md` (Auth). Never describe this service as protected until those steps are done.
- The server listens on port 8000 and boots with no `.env` and an empty environment. Add an environment variable only when code reads it, in `src/config.ts`, with a fake value in `.env.example`.

## Standard flow for adding a feature

1. Read this file, then the rules the table names for the task.
2. Required for every new capability: extend through ports and `createXxx(deps)` factories wired in one place (`docs/rules/extending.md`). Copy the shape of `src/hello/`: `routes.ts`, `service.ts`, `schemas.ts` and a `tests/` folder. Export `createXxxModule(deps)` and add it to the `modules` array in `src/main.ts`.
3. Throw `AppError` for every failure the client may see; add table entries where needed.
4. Write the tests: the envelope of each route and each failure path.
5. Record it in the Traditional Chinese docs: the route in the index of `docs/apis/README.md` and in its own page under `docs/apis/`, tables in `docs/database.md`, the domain in `docs/README.md`.
6. Run the commands above and fix what fails.
