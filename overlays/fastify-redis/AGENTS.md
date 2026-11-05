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

## Node conventions

- Dates go through `date` in `src/common/date.ts`, the only file that imports dayjs.
- Services throw `AppError` with a code from the failure table in `src/common/errors/failures.ts`; the code is never serialised. A new failure is a new table entry plus a row in the failure table of `docs/apis/conventions.md`.
- Wire format (`docs/rules/api-and-errors.md`): every wire key is snake_case while code stays camelCase, mapped field by field at the boundary with no generic key rewriter; ids are UUIDs, strings on the wire; instants are ISO 8601 strings; paths are plural kebab-case; `page_size` defaults to 20 and is capped at 100; failure messages are English.
- Imports use the `.js` extension (ESM). Tests live in the owning folder's `tests/`.
- Comments and docstrings are English; JSDoc (`/** ... */`) on functions, classes and modules, with `@param`, `@returns`, `@throws` as applicable.

## Commands

`pnpm dev`, `pnpm build`, `pnpm start`, `pnpm lint`, `pnpm format:check` (`pnpm format` rewrites), `pnpm typecheck`, `pnpm test` (single run). A change is done when lint, format:check, typecheck, test and build pass.

## Stack

Stack: Fastify 5, zod validation (fastify-type-provider-zod), pino, dayjs behind `src/common/date.ts`, Vitest, ESLint 10 and Prettier, pnpm. The data rules are in `docs/rules/data.md`; a project with a store has that store's own rule page beside it.

This is a starter with two public routes, `GET /api/v1/hello` and the health route `GET /api/health` (outside `/api/v1` and the envelope), built on the shared handlers (envelope, failure table, error handler, request id, access log) and the `createInfra` seam in `src/infra/` that holds what the process depends on. Add domains on top of them; do not rewrite them.

## Fastify rules

- New backend capabilities are developed through ports and `createXxx(deps)` factories, wired in one place; this is required, not optional (`docs/rules/extending.md`).
- Layers: route, then service, then repository. Cross-domain calls go service to service, never to another domain's repository. A route parses, calls one service function and returns data.
- Validate at the edge with zod (environment, request and response schemas) through the type provider.
- Every answer uses the one response envelope. Routes return `success(...)` or `paginated(...)` and declare `successEnvelope(...)` or `pagedEnvelope(...)` as the response schema; only `registerErrorHandling` builds a failure body. Lists are always paged.
- Auth: this template ships no authentication. Every route it has is public. Before any non-public route ships, add an `onRequest` hook on the root instance with an explicit `config: { public: true }` opt-out; the steps are in `docs/rules/api-and-errors.md` (Auth). Never describe this service as protected until those steps are done.
- The server listens on port 8000. Add an environment variable only when code reads it, in `src/config.ts`, with a fake value in `.env.example`; a variable that names a service the server cannot run without is declared in `src/infra/infra-env.ts` and is required.
- Tests call `buildServer` directly and pass no seam, and the test runner loads the fake values of `.env.example`, so `pnpm test` needs no service.

## Standard flow for adding a feature

1. Read this file, then the rules the table names for the task.
2. Required for every new capability: extend through ports and `createXxx(deps)` factories wired in one place (`docs/rules/extending.md`). Copy the shape of `src/hello/`: `routes.ts`, `service.ts`, `schemas.ts` and a `tests/` folder. Export `createXxxModule(deps)` and add it to the `modules` array in `src/main.ts`.
3. Throw `AppError` for every failure the client may see; add table entries where needed.
4. Write the tests: the envelope of each route and each failure path.
5. Record it in the Traditional Chinese docs: the route in the index of `docs/apis/README.md` and in its own page under `docs/apis/`, tables in `docs/database.md`, the domain in `docs/README.md`.
6. Run the commands above and fix what fails.

## Docker

These rules apply when the project has a `Dockerfile`, a `docker-compose.yml` and a `.dockerignore`; a project that declined them has none of the three. The full rules are in `docs/rules/docker.md`.

- No secret enters an image. A server's runtime values come from `.env` through `env_file` and from `environment`; a web service reads no `env_file`, only build arguments and `environment`. The only build arguments allowed are `API_HOST` and `PART`, and `.dockerignore` keeps `.env`, `node_modules` and `todos` out of the build context.
- The image runs as a numeric non-root uid and never root: 1000, or 101 in the nginx image of a Vite project. It holds only the built output and, for a server, its production dependencies.
- `COMPOSE_PROJECT_NAME` in `.env` must be set. It names the compose project, so two projects on one machine never share a container or a volume.
- A server answers `GET /api/health` inside its container; its compose healthcheck reads that route through the image's own runtime, and a failing dependency check marks the container unhealthy. A web service's healthcheck reads `/`, never the API, so an API outage does not mark it unhealthy.
- Published ports bind to `127.0.0.1`; a proxy in front of the project is the way to open one wider.

## Data

No database is installed: this project has Redis alone, `docs/database.md` lists no tables, and the naming and transaction rules in `docs/rules/data.md` apply from the first table on, whichever store it is. Redis holds only disposable state, so nothing may be kept only there.

## Redis

- Cache, lock, pub/sub and queue work follows `docs/rules/redis.md`: keys are `<service>:<entity>:<id>`, every key written by application code has a TTL, never `FLUSHALL`, `FLUSHDB` or `KEYS`.
- An unreachable Redis answers 503, not 500, and anything in it may be lost: the database stays the source of truth.
- `REDIS_URL` is required and the only value a server run on the host reads; both compose files run the service, and a containerised server always reaches it as `redis:6379`. The default rate limit counts in Redis, so every instance shares one limit, and it answers 503 rather than letting requests through uncounted when Redis is unreachable.

## Redis on Fastify

Take the client from the infra seam: `createInfra(config)` in `src/infra/infra.ts` returns `redis` (the `ioredis` client of `src/redis/client.ts`), and `main.ts` passes it to the factories it wires. `createInfra` creates the client once and its `close` ends it; never create another. The rate limit's counts live in Redis through `src/redis/rate-limit-store.ts`, which `createInfra` returns as `rateLimitStore`; it answers 503 when Redis does not answer within a second and never lets a request through uncounted. `pnpm test:integration` runs the Redis tests against the compose service (start it first, and copy `.env.example` to `.env`).
