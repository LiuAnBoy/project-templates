# Architecture: plain Fastify

These rules govern all new code in this project. It is a small, single-purpose service shape: one folder per domain, thin routes, and a single response envelope. If the service grows many modules, auth and a queue, move to a structured framework instead of building one by hand.

## Layout

```text
src/
  main.ts            # loads config, builds the infra and the server, runs the startup checks, listens, closes on shutdown signals
  server.ts          # buildServer(): everything registered, not yet listening (shared with tests)
  config.ts          # zod env schema, spreading infra/infra-env.ts
  infra/             # the seam: createInfra(config), types.ts, infra-env.ts; what the process depends on
  common/
    errors/          # failures.ts (the table and AppError), failure.ts, dependency-failure.ts
    http/            # envelope.ts, error-handler.ts, access-log.ts, request-id.ts, json-body-parser.ts, ...
    logging/         # logger-options.ts
    concurrency/     # bounded.ts
    dependency-checks.ts  # DependencyCheck, the health probe and the startup gate
    assert-never.ts
    module.ts        # ServerModule type
    registry.ts      # createRegistry<T>()
  <domain>/
    routes.ts        # createXxxModule(deps): thin, parse, call the service, return data
    service.ts       # createXxxService(deps): business flow, owns the transaction
    <port>.ts        # port interface and its createXxx factories
    schemas.ts       # zod request and response schemas
    tests/<domain>.<case>.test.ts
```

A `repository.ts` (the only place a query is written) joins a domain when it first needs one: a folder or file exists when it holds code. There is no catch-all `utils/`, and no `.gitkeep`.

- File names are lower-case. Imports use the `.js` extension, because the project is ESM.
- A route parses its input through its schema, calls one service function, and returns `success(...)`. No query, no business rule.
- Across domains, call the other domain's service, never its repository.

## Setup

- Fastify 5, TypeScript, ESM, `fastify-type-provider-zod`. Keep one `fastify` version in the dependency tree.
- Validation is zod through the type provider: `buildServer()` sets both compilers on the instance. Each route declares `schema: { params, querystring, body, response }` with zod schemas, so types, validation and serialisation come from one place. In a monorepo, schemas shared with the web live in the `@app/contract` package.
- `buildServer()` returns an instance that has not started listening, so tests use `app.inject()`.
- `main.ts` loads config, builds the infra and the server, runs the startup checks, listens, and closes the server on shutdown signals. A failed start closes what it opened before exiting.
- Plugins are encapsulated scopes (`app.register`). A route with a special body parser (raw bytes for signature checks) lives in its own scope so the parser affects no other route. Two network surfaces (public and internal) are two Fastify instances, so a route can never leak across the boundary.

## Config

`config.ts` parses the environment with a zod object once at boot and exports the typed result. Use `z.coerce.number()` for ports, `z.url()` for URLs, and `superRefine` for cross-field rules. A malformed or missing required value stops the process, naming the variable and never its value. A variable has a development default unless it names a service the server cannot run without (`data.md`, Dependencies); the connection settings of a store are declared in `infra/infra-env.ts`, which the schema spreads in. No host, port or credential default is production-safe. Add a variable when code reads it, and add it to `.env.example` with a fake value; the tests run with the values of that file, so a required variable left out fails them. The server listens on port 8000 by default.

## Extension

Capabilities are added through ports and `createXxx(deps)` factories, connected at one wiring place. See `extending.md`; `hello` is the model.

## The infrastructure seam

`src/infra/` is the one place that knows what the process depends on. `createInfra(config)` returns the dependency checks, an optional shared store for the rate limit and a close function. `main.ts` passes the checks to `buildServer` (where `healthRoutes` runs them) and the store to `rateLimit.store`, and calls `close` on shutdown and after a failed start. A project with no store returns no checks, no store and a close that does nothing, so it starts as the base does. A data overlay replaces the files of `src/infra/` and adds its own folders (`src/db/`, `src/redis/`); no other file under `src/` changes.

- Startup: after the server is built and before it listens, `main.ts` runs every check under `bounded()`; a failure closes what was opened and exits non-zero naming the check and never a value.
- A dependency lost after startup answers 503 through `isDependencyOutage`; the process stays up. Each client's factory handles its own `error` events so a lost connection is logged once.
- Tests call `buildServer` directly and pass no seam, so they never reach `main.ts` and need no service.

## Envelope and errors

Shapes, the failure table and `AppError` are in `api-and-errors.md`.

- Success: routes return `success(data)` and declare their response as `successEnvelope(dataSchema)`; list routes return `paginated(...)`.
- Failure: one error handler builds every failure body from the table, and the not-found handler answers the unknown route in the same envelope.
- The envelope exceptions are the ones listed in `api-and-errors.md`; note each in the route's doc comment.

## Auth and safety

The request limit is on by default: `buildServer` registers `@fastify/rate-limit` through `registerRateLimit`, and `TRUST_PROXY` reaches Fastify's `trustProxy` through the config schema, which rejects blanket-trust values (`api-and-errors.md`, Rate limiting). `@fastify/helmet` is already registered. This template ships no authentication (see `api-and-errors.md`, Auth). When it is added:

- Mount it once, above every route, as an `onRequest` hook on the root instance before any `app.register`. A route is public only when it carries `config: { public: true }`.
- Verify webhook signatures over the raw body before parsing JSON; fail closed (503) when the verifier's dependency is down.
- The health route (`src/health/routes.ts`) is public, answers the bare probe body and has `config: { rateLimit: false }`; mark it public in the same change as the auth hook.
- No CORS: the browser reaches the API same-origin through the web app's `/api/v1` proxy (`api-and-errors.md`, Auth).
- With more than one instance, return a shared store as `rateLimitStore` from `createInfra`.

## Data access

The rules are in `data.md`: the service owns the transaction scope and passes the handle to each repository call, and queries live only in repositories. A store's own page adds what is specific to it.

## Logging and lifecycle

- Fastify's pino logger writes structured records to stdout. The access log records the route pattern, never the concrete URL, and the request id comes from a safe `x-request-id` or a new UUID. The logger removes authorization and cookie headers; never log secrets or tokens.
- Time-driven jobs scan for due rows on a schedule; they do not enqueue delayed jobs for the future.

## Tests

- Vitest with `app.inject()`, run once with `pnpm test`, which excludes `*.integration.test.ts` and needs no service. Tests live in the owning folder's `tests/`. A test that needs a route which fails on purpose registers it on the instance returned by `buildServer()` before the first request.
- Tests that need a real store are `*.integration.test.ts` and use a real store, never a mock of the repository layer.
- Guard the contract of each route (status and envelope) and every risky path (signature check, dedupe, transaction rollback); one regression test per real bug.

## Adding a domain

1. Create `src/<domain>/` with `routes.ts`, `service.ts`, `schemas.ts` and `tests/`.
2. Export `create<Domain>Module(deps)` and add it to the `modules` array in `main.ts`; `buildServer` mounts it under `/api/v1`.
3. Services throw `AppError` with a table code; routes return `success(...)`.
4. Update the docs listed in `docs-to-update.md` in the same change.
