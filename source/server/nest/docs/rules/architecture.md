# Architecture: NestJS 11 on Fastify

These rules govern all new code in this project. It is a medium or large backend shape: modules, controllers, services, and a single response envelope.

## Layout

```text
src/
  main.ts            # NestFactory + FastifyAdapter, only boots; runs the startup checks
  bootstrap.ts       # adapter, body parser, helmet, request id, global prefix (shared with tests)
  app.module.ts      # imports modules; provides the global pipe, interceptor, filter, throttler guard
  config/env.ts      # zod env schema, spreading infra/infra-env.ts
  infra/             # the seam: InfraModule (global), tokens.ts, infra-env.ts; what the process depends on
  common/
    errors/          # failures.ts (the table), app-error.ts, failure.ts, dependency-failure.ts
    http/            # decorators/, filters/, interceptors/, response.ts, access-log.ts, request-id.ts, ...
    logging/         # logger.options.ts
    concurrency/     # bounded.ts
    dependency-checks.ts  # DependencyCheck, the health probe and the startup gate
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
  test/create-app.ts # boots the real application for tests, with the infra stub
```

`repositories/` and `domain/` (pure helpers with no Nest injection) join a module when it first needs them: a folder exists when it holds a file. There is no catch-all `utils/`, and no `.gitkeep`.

- File names are lower-case kebab, carry the domain and end in the role (`orders-admin.service.ts`), never a bare `service.ts`.
- A controller handles HTTP only; a service holds the business flow; a repository touches the store only. When a module grows, split the service and let each controller depend on its specialised service. Do not add a forwarding facade.
- Across modules, inject the other module's service (exported from its module), never its repository.
- Constructor injection with `@Injectable()`. Use a factory provider only when the object cannot be built without config (`forRootAsync`).
- Imports use the `.js` extension, because the project is ESM. Do not use `import type` for a class Nest injects: the decorator metadata needs the value.

## Env schema

`config/env.ts` parses the environment once at boot; a malformed or missing required value stops the process, naming the variable and never its value. A variable has a development default unless it names a service the server cannot run without (`data.md`, Dependencies); the connection settings of a store are declared in `infra/infra-env.ts`, which `envSchema` spreads in.

- `main.ts` validates `process.env` before it builds the HTTP adapter, which is before `ConfigModule` loads anything, so Node itself loads `.env`: `pnpm start` runs `node --env-file-if-exists=.env dist/main.js` and `pnpm dev` runs `nest start` with the same flag through `--exec`.
- Wire it with `ConfigModule.forRoot({ validate: validateEnv })` and read through `ConfigService<Env, true>`.
- Add a variable when code reads it, not in anticipation, and add it to `.env.example` with a fake value; the tests run with the values of that file, so a required variable left out fails them.
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

## The infrastructure seam

`src/infra/` is the one place that knows what the process depends on. `InfraModule` is global and exports two tokens: `DEPENDENCY_CHECKS`, the `DependencyCheck[]` that `HealthController` runs and that `main.ts` runs before `listen`, and `RATE_LIMIT_STORAGE`, the optional shared storage that `AppModule` passes to `createThrottlerOptions`. A project with no store provides no checks and no storage, so it starts as the base does. A data overlay replaces `infra.module.ts` and `infra-env.ts`, and nothing else changes.

- Startup: after the application is built and before it listens, `main.ts` runs every check under `bounded()`; a failure closes the application and exits non-zero naming the check and never a value.
- A dependency lost after startup answers 503 through `isDependencyOutage`; the process stays up. Each client's factory handles its own `error` events so a lost connection is logged once.
- Tests: `createTestApp` replaces `InfraModule` with `StubInfraModule` (`src/test/`), which provides both tokens with no checks and no storage, before the caller's `override`. The tests never reach `main.ts`.

## Envelope and errors

Shapes, the failure table and `AppError` are in `api-and-errors.md`. Controllers return plain data; the global interceptor wraps it and the global filter builds every failure.

## Auth, security, throttling

The request limit is on by default: `ThrottlerGuard` is a global `APP_GUARD` in `app.module.ts`, and `TRUST_PROXY` is read through the env schema, which rejects blanket-trust values, before `main.ts` builds the adapter (`api-and-errors.md`, Rate limiting). This template ships no authentication (see `api-and-errors.md`, Auth). When it is added:

- Global `APP_GUARD`s in order: the throttler that is already there, then JWT auth (on by default, `@Public()` opts out), then an authorisation guard. The throttler comes first so that a flood of failed sign-ins is counted.
- Allow the one configured web origin in CORS; `@fastify/helmet` is already registered in `bootstrap.ts`.
- With more than one instance, provide a shared storage as `RATE_LIMIT_STORAGE` in `InfraModule`.

## Data access

The rules are in `data.md`: repositories take the transaction handle explicitly, the service owns the transaction scope, and queries live only in repositories. A store's own page adds what is specific to it.

## Logging and lifecycle

- `nestjs-pino` writes structured logs to stdout. The access log records the route pattern, never the concrete URL, and the request id also tags failures. Never log secrets or tokens; the logger removes authorization and cookie headers.
- `app.enableShutdownHooks()` is on; boot uses `abortOnError: false` so an initialisation failure rejects with a readable message instead of killing the process.
- Time-driven jobs scan for due rows on a schedule; they do not enqueue delayed jobs for the future.

## Tests

- Unit tests `*.test.ts`, and tests that need a real store `*.integration.test.ts`, both under the owning folder's `tests/`. Vitest, run once with `pnpm test`, which excludes `*.integration.test.ts` and needs no service.
- Boot the real application with `test/create-app.ts`; it uses the same adapter and `configureApp` as `main.ts`, so a plugin registered there is under test. A test that needs a route which fails on purpose passes a test-only controller to `createTestApp`. Its third argument is the environment for that one app (`{ RATE_LIMIT_MAX: '2' }`): `ConfigModule` validates `process.env` when `app.module.ts` is imported, so a test cannot change a setting through `process.env`.
- Integration tests run against a real store, never a mock of the repository layer.
- Guard a module's public contract (status and envelope of each route) and every risky path (permission checks, concurrency, transactions); one regression test per real bug.

## Adding a module

1. Create `modules/<domain>/` with its module, controller, service and DTO files, and register the module in `app.module.ts`.
2. Controllers return plain data or `paginated(...)`; services throw `AppError` with a table code.
3. Add the tests under the module's `tests/`: the envelope of each route, and every failure path.
4. Update the docs listed in `docs-to-update.md` in the same change.
