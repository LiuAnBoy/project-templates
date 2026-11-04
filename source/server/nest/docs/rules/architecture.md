# Architecture: NestJS 11 on Fastify

These rules govern all new code in this project. It is a medium or large backend shape: modules, controllers, services, and a single response envelope.

## Layout

```text
src/
  main.ts            # NestFactory + FastifyAdapter, only boots
  bootstrap.ts       # adapter, body parser, helmet, request id, global prefix (shared with tests)
  app.module.ts      # imports modules; provides the global pipe, interceptor, filter
  config/env.ts      # zod env schema
  common/
    errors/          # failures.ts (the table), app-error.ts, failure.ts, dependency-failure.ts
    http/            # decorators/, filters/, interceptors/, response.ts, access-log.ts, request-id.ts, ...
    logging/         # logger.options.ts
    concurrency/     # bounded.ts
    assert-never.ts
    registry.ts      # createRegistry<T>()
  modules/<domain>/
    <domain>.module.ts
    controllers/<domain>-<area>.controller.ts
    services/<domain>-<area>.service.ts
    dto/<domain>-<area>.dto.ts
    ports/<name>.port.ts       # interface + DI token
    providers/<impl>.ts        # createXxx(deps) factories
    tests/<domain>.<case>.test.ts
  test/create-app.ts # boots the real application for tests
```

`repositories/`, `domain/` (pure helpers with no Nest injection) and `infra/` (database, redis, mailer) join a module when it first needs them: a folder exists when it holds a file. There is no catch-all `utils/`, and no `.gitkeep`.

- File names are lower-case kebab, carry the domain and end in the role (`orders-admin.service.ts`), never a bare `service.ts`.
- A controller handles HTTP only; a service holds the business flow; a repository touches the database only. When a module grows, split the service and let each controller depend on its specialised service. Do not add a forwarding facade.
- Across modules, inject the other module's service (exported from its module), never its repository.
- Constructor injection with `@Injectable()`. Use a factory provider only when the object cannot be built without config (`forRootAsync`).
- Imports use the `.js` extension, because the project is ESM. Do not use `import type` for a class Nest injects: the decorator metadata needs the value.

## Env schema

`config/env.ts` parses the environment once at boot; a malformed value stops the process, and every variable has a development default, so the server boots with no `.env`.

- Wire it with `ConfigModule.forRoot({ validate: validateEnv })` and read through `ConfigService<Env, true>`.
- Add a variable when code reads it, not in anticipation, and add it to `.env.example` with a fake value.
- The server listens on port 8000 by default.

## Validation: the zod pipe

Contracts are zod schemas; DTO classes are thin shells so Nest sees a class. Do not use class-validator.

```ts
import { createZodDto } from 'nestjs-zod';

/** Request body of `POST /orders`; the schema is the contract. */
export class CreateOrderDto extends createZodDto(createOrderSchema) {}
```

`ZodValidationPipe` is registered once in `app.module.ts` as `APP_PIPE`. In a monorepo, put schemas shared with the web in the `@app/contract` package and import them from both sides. Business computation never goes in that package.

## Extension

Capabilities are added through ports and `createXxx(deps)` factories, connected at one wiring place. See `extending.md`; `hello` is the model.

## Envelope and errors

Shapes, the failure table and `AppError` are in `api-and-errors.md`. Controllers return plain data; the global interceptor wraps it and the global filter builds every failure.

## Auth, security, throttling

This template ships no authentication (see `api-and-errors.md`, Auth). When it is added:

- Global `APP_GUARD`s in order: JWT auth first (on by default, `@Public()` opts out), then an authorisation guard, then a throttler backed by Redis storage.
- Allow the one configured web origin in CORS; `@fastify/helmet` is already registered in `bootstrap.ts`.
- Read `trustProxy` from env through a zod schema that rejects blanket-trust values, before the adapter is built.

## Data access

This template ships no database. When one is added, follow `postgres.md`: repositories take the transaction handle explicitly, the service owns the transaction scope, and SQL lives only in repositories.

## Logging and lifecycle

- `nestjs-pino` writes structured logs to stdout. The access log records the route pattern, never the concrete URL, and the request id also tags failures. Never log secrets or tokens; the logger removes authorization and cookie headers.
- `app.enableShutdownHooks()` is on; boot uses `abortOnError: false` so an initialisation failure rejects with a readable message instead of killing the process.
- Time-driven jobs scan for due rows on a schedule; they do not enqueue delayed jobs for the future. Queues and locks: `redis.md`.

## Tests

- Unit tests `*.test.ts`, and database or Redis tests `*.integration.test.ts`, both under the owning folder's `tests/`. Vitest, run once with `pnpm test`.
- Boot the real application with `test/create-app.ts`; it uses the same adapter and `configureApp` as `main.ts`, so a plugin registered there is under test. A test that needs a route which fails on purpose passes a test-only controller to `createTestApp`.
- Integration tests run against a real PostgreSQL, never a mock of the repository layer.
- Guard a module's public contract (status and envelope of each route) and every risky path (permission checks, concurrency, transactions); one regression test per real bug.

## Adding a module

1. Create `modules/<domain>/` with its module, controller, service and DTO files, and register the module in `app.module.ts`.
2. Controllers return plain data or `paginated(...)`; services throw `AppError` with a table code.
3. Add the tests under the module's `tests/`: the envelope of each route, and every failure path.
4. Update the docs listed in `docs-to-update.md` in the same change.
