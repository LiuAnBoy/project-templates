# Data: names, ids, instants, transactions and dependencies

These rules hold for every project of this template, whether or not it has a store. A store is chosen once, when the project is created, by extracting a data overlay over the template; the overlay adds that store's own rule page, and this page does not change. Node projects use Drizzle for the schema and migrations, FastAPI projects use SQLAlchemy and Alembic.

## Names, keys and instants

- Tables and columns are snake_case (`page_count`), never camelCase. Code maps rows to its own convention in the repository, field by field.
- Every table has `id`, `created_at` and `updated_at`. `id` is a UUID and travels as a string on the wire; never use serial or identity integers as public ids. Every update sets `updated_at`.
- Instants travel as ISO 8601 strings and are never Unix integers, in the API and in the store where the store has a zoned instant type (`api-and-errors.md`).
- There is no soft delete by default: a delete removes the row. A table that needs one adds a nullable `deleted_at`, and its repository filters on it everywhere.

## Queries and transactions

- Queries appear only in repositories. Controllers, routes and services never build one, so a query has one place to review when the schema moves.
- The service owns the transaction scope. It opens the transaction, passes the handle explicitly to every repository call inside it, and commits or rolls back. A repository method that writes takes the caller's handle as a required parameter; a read may default to the pool.
- Do not use ambient transactions (AsyncLocalStorage, request-scoped repositories): a mistake there does not throw, it silently loses atomicity.
- Side effects that cannot join the transaction (queues, caches, events, mail) run after it commits.

## Schema and migrations

- The schema lives in code and owns the store: the Drizzle schema, or the SQLAlchemy models. Migrations are generated from it, reviewed like code and committed.
- Never edit an applied migration; fix forward with a new one. A destructive change ships in its own migration, after the code that stopped using the thing has been deployed.
- The database page of `docs/` lists the tables that exist, and changes in the same change as the schema.

## Dependencies

- What the process depends on is created in `src/infra/` and nowhere else: the factory of each store, its dependency checks, the shared storage of the rate limit and a close function. A project with no store has none of these, and starts as the base does.
- A connection setting has no default and is required: a missing one stops the process before it serves, naming the variable and never a value. A project moves to another server by changing `.env` alone.
- Before the server listens, every dependency check runs under `bounded()`. A failed check exits non-zero naming the dependency and never a value, because a driver's error text can carry the host, the path or the URL.
- A dependency lost after startup answers 503 through `isDependencyOutage` (`is_dependency_outage`) and the process stays up. `GET /api/health` runs the same checks through one shared probe, answers 200 `{"status":"ok"}` or 503 `{"status":"unavailable"}` with no check name in the body, and stays exempt from the rate limit.
- Wrap every dependency call on the request path in `bounded()`.
- A log never holds a bound value, a key, a URL, a host or a path. A failed statement is logged with its text and its code and without its parameters, and a driver error that quotes a value, or names the host, is logged with its class and without its message (`describeFailure` on Node, `format_failure` on FastAPI).

## Tests

- Ordinary tests (`pnpm test`, `make test`) need no service: the tests replace the `src/infra/` seam with one that has no checks and no shared storage, and the fake settings come from `.env.example`.
- A test that needs a real store is an integration test with its own command. It uses a throwaway schema or a prefixed key, never a shared one, and refuses a non-local host.
