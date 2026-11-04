# SQLite: schema, migrations, query layer and transactions

SQLite is accessed through Drizzle on `better-sqlite3`. The Drizzle schema, written in TypeScript, owns the database schema; migrations are SQL files generated from it, reviewed and committed. The store-neutral rules are in `data.md`; this page adds what is specific to SQLite. SQLite suits one server instance that owns its file; a project that runs several instances against one database chooses a server store instead.

## Connection settings

- The server reads `DATABASE_URL`, the path of the database file, relative to the directory the server starts in. A missing value stops the boot, naming the variable.
- The file must already exist. Only `pnpm db:migrate` creates it, so a wrong path stops the boot, naming the dependency and never the path, instead of starting an empty database. `:memory:` is not supported, because the store holds two connections.
- `src/db/database.ts` is the one file that names SQLite. It exports `createDatabase(config)`, which returns the Drizzle client, the transaction runner, a probe and a close, and the `src/infra/` seam calls it once. Never open the file a second time from application code.
- The `data/` folder holds the file and has its own `.gitignore`, so the database is never committed. Back it up with `VACUUM INTO` or the `.backup` command, never by copying the file alone: WAL mode keeps recent writes in the `-wal` file beside it.

## Schema and migrations

- The schema lives in TypeScript under `src/db/schema/`, one file per aggregate, each exported from `src/db/schema/index.ts`. Nothing else defines a table.
- Write every column name explicitly in snake_case (`text('created_at')`), so the SQL names never depend on a casing option.
- After changing the schema run `pnpm db:generate`. It writes SQL into `drizzle/`. Read that SQL in review like code, and commit it together with the schema change. SQLite cannot alter every column in place, so a change to a column's type or constraints is generated as a table rebuild: read it with that in mind.
- Never run `drizzle-kit push` on a database that holds data you keep: it changes the schema without leaving a migration to review or replay.
- Never edit an applied migration. Fix forward with a new one generated from the schema.
- Destructive changes (drop a column or table, narrow a type) ship in their own migration, after the code that stopped using the thing has been deployed.

## Migration lifecycle

### Baseline

- Before the project's first production deploy there is one baseline. While nothing is deployed, a schema change regenerates it: remove the generated migrations (the `0000_` SQL file in `drizzle/` and `drizzle/meta/`) and run `pnpm db:generate` again, so the first deploy applies a single file.
- After the first production deploy the baseline never changes. Every schema change is a new generated migration, reviewed and committed.

### Applying and tracking

- Drizzle records what ran in the table `__drizzle_migrations`; `drizzle/meta/_journal.json` lists the migrations that exist. Nothing keeps its own list by hand.
- `pnpm db:migrate` is the only way the database changes, and the only thing that creates the file. It applies only what is not recorded, does nothing when the database is up to date, and prints the counts, the names it applied and the record afterwards. It is a plain Node script, so a deploy image without dev dependencies can run it.
- `pnpm db:status` lists the migrations that are still pending and never writes. A missing file means nothing is applied, and a project with no table yet has nothing pending.
- Run `pnpm db:migrate` once per deploy, before the new code starts, while the server is stopped or idle.

### Branches and the journal

Drizzle's migrator applies a migration only when its journal `when` is newer than the newest one recorded in the database. A migration generated on a branch and merged after a newer one has already run would be skipped silently, with no error. Both scripts detect that case, name the migration and exit 1. Generate on top of the latest trunk right before merging, and regenerate the migration if the trunk gained one in the meantime.

## Repositories and transactions

- SQL appears only in repositories. Controllers, routes and services never build a query. A query has one place to review and to change when the schema moves.
- Drizzle builds the queries. Raw SQL through Drizzle's `sql` tag is fine in a repository when the builder cannot express the query.
- The service owns the transaction scope. It opens the transaction with the runner from `createDatabase`, `transactions.run(tx => ...)` (the `TRANSACTION_RUNNER` token on Nest, `infra.transactions` on Fastify), passes the transaction handle explicitly to every repository call inside it, and commits or rolls back. Do not use AsyncLocalStorage or request-scoped repositories: a mistake there does not throw, it silently loses atomicity.
- A repository method that writes takes the caller's handle as a required parameter. Reads may default to the client.

### Two connections

- `better-sqlite3` refuses a transaction whose callback returns a promise, so the runner does not wrap Drizzle's `db.transaction`. The store holds two connections: the client (`DATABASE` on Nest, `infra.db` on Fastify) reads, and the runner takes an in-process lock on the second, issues `BEGIN IMMEDIATE`, awaits the callback and commits or rolls back.
- The client's connection is `query_only`: a write through it fails instead of landing outside a transaction. Every write goes through the runner, and the handle the runner passes down is the only writer.
- A read through the client does not see work a transaction has not committed, because the database is in WAL mode.
- A second `run` waits for the first, so writes serialise. The wait is bounded: past `writeWaitMs` (5 seconds) it fails as a busy store, which answers 503.
- A `run` called from inside another `run` is refused at once, with an error that names the cause, and answers 500 because it is a bug. It would otherwise wait for a lock its own callback holds and stop every write until a restart. Pass the handle down instead. The lock stays usable after a refusal or a timeout.
- Keep a transaction short and never await a slow call, such as an HTTP request, inside it: the writing connection is held for the whole callback.
- Queue and cache side effects run after the transaction commits, because they cannot join it.

## Rows and types

### Names and keys

- Tables and columns are snake_case (`page_count`), never camelCase. The schema names each column explicitly; code maps rows to its own convention in the repository, field by field.
- Every table has `id`, `created_at` and `updated_at`. `id` is a `text` primary key holding a UUID that the application generates (`crypto.randomUUID()`) and travels as a string on the wire; do not use autoincrement integers as public ids. `created_at` and `updated_at` are `text` and not null, and every update sets `updated_at` in the repository's update statement.
- There is no soft delete by default: a delete removes the row. A table that needs one adds a nullable `deleted_at text`, and its repository filters on it everywhere.

```ts
export const orderItems = sqliteTable('order_items', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  orderId: text('order_id')
    .notNull()
    .references(() => orders.id),
  pageCount: integer('page_count').notNull(),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
```

### Types and constraints

- SQLite has no instant type. Store every instant as an ISO 8601 UTC string in a `text` column (`new Date().toISOString()`), never as a Unix integer, so the value sorts and travels unchanged. The API carries instants as ISO 8601 strings (`api-and-errors.md`).
- Store money as an integer count of the smallest unit, never as a float.
- Foreign keys are enforced because the store turns the pragma on for both connections; declare them in the schema anyway.
- Constraints belong in the schema (`notNull`, `unique`, `check`, foreign keys), not only in the application. A unique violation maps to a 409 through the failure table in `api-and-errors.md`.
- Index every foreign key and every column a list endpoint filters or sorts on.
