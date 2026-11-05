# PostgreSQL: schema, migrations, query layer and transactions

PostgreSQL is accessed through Drizzle. The Drizzle schema, written in TypeScript, owns the database schema; migrations are SQL files generated from it, reviewed and committed. One source of truth means a schema change is one diff that a reviewer reads in two forms: the TypeScript and the SQL it produced. The store-neutral rules are in `data.md`; this page adds what is specific to PostgreSQL.

## Connection settings

- The server reads `DATABASE_URL`, a plain `postgresql://` URL, and nothing in code names a host or a credential. A missing value, or a URL the driver cannot read (a port that is not a number, an unparsable host), stops the boot naming the variable and never the value.
- In containers (`docker-compose.yml`) compose builds `DATABASE_URL` for `server` and `migrate` from `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE` and the service name, so `.env`'s `DATABASE_URL` serves a server run on the host. `POSTGRES_PASSWORD` must be URL-safe (letters, digits, `-`, `.`, `_`, `~`), because compose cannot encode it. Neither container receives the superuser password as a variable.
- `POSTGRES_DATABASE` is the plain database name. The project's own service creates it, and on a shared server it must name a database that exists there, because compose does not create it.
- `POSTGRES_PORT` is the loopback port of the project's service. To use a shared PostgreSQL server that runs on a docker network, change four lines of `.env` and nothing else: `COMPOSE_FILE` (to `docker-compose.yml:docker-compose.postgres-cluster.yml`), `POSTGRES_DOCKER_NETWORK`, `DATABASE_URL` and `POSTGRES_DATABASE`. Keep `POSTGRES_PASSWORD` set. Restoring `.env` brings the local service back.
- `src/db/database.ts` is the one file that names PostgreSQL. It exports `createDatabase(config)`, which returns the Drizzle client, the transaction runner, a probe and a close, and the `src/infra/` seam calls it once. Never open a second pool: a connection of the pool has its `error` listener, and one a project creates by hand ends the process when it is lost, unless it listens itself.
- `TEST_DATABASE_URL` is read only by `pnpm test:integration`, which refuses a host that is not local and works in a throwaway schema of its own.

## Schema and migrations

- The schema lives in TypeScript under `src/db/schema/`, one file per aggregate, each exported from `src/db/schema/index.ts`. Nothing else defines a table.
- Write every column name explicitly in snake_case (`timestamp('created_at', ...)`), so the SQL names never depend on a casing option.
- After changing the schema run `pnpm db:generate`. It writes SQL into `drizzle/`. Read that SQL in review like code, and commit it together with the schema change.
- Never run `drizzle-kit push` on a shared database: it changes the schema without leaving a migration to review or replay.
- Never edit an applied migration. Fix forward with a new one generated from the schema.
- Destructive changes (drop a column or table, narrow a type) ship in their own migration, after the code that stopped using the thing has been deployed.

## Migration lifecycle

### Baseline

- Before the project's first production deploy there is one baseline. While nothing is deployed, a schema change regenerates it: remove the generated migrations (the `0000_` SQL file in `drizzle/` and `drizzle/meta/`) and run `pnpm db:generate` again, so the first deploy applies a single file.
- After the first production deploy the baseline never changes. Every schema change is a new generated migration, reviewed and committed.

### Applying and tracking

- Drizzle records what ran in `drizzle.__drizzle_migrations`; `drizzle/meta/_journal.json` lists the migrations that exist. Nothing keeps its own list by hand.
- `pnpm db:migrate` is the only way a shared database changes. It applies only what is not recorded, does nothing when the database is up to date, and prints the counts, the names it applied and the record afterwards, so a deploy log shows which files ran instead of a silent success. It is a plain Node script, so a deploy image without dev dependencies can run it. A failure prints the statement and the cause; a failure to connect prints fixed text and a code, never the host or the user.
- `pnpm db:status` lists the migrations that are still pending and never writes. A project with no table yet has none, and both commands say so.
- Run `pnpm db:migrate` once per deploy, before the new code starts. Two runners against one database at once are not guarded.

### Branches and the journal

Drizzle's migrator applies a migration only when its journal `when` is newer than the newest one recorded in the database. A migration generated on a branch and merged after a newer one has already run would be skipped silently, with no error. Both scripts detect that case, name the migration and exit 1. Generate on top of the latest trunk right before merging, and regenerate the migration if the trunk gained one in the meantime.

## Repositories and transactions

- SQL appears only in repositories. Controllers, routes and services never build a query. A query has one place to review and to change when the schema moves.
- Drizzle builds the queries. Raw SQL through Drizzle's `sql` tag is fine in a repository when the builder cannot express the query.
- The service owns the transaction scope. It opens the transaction with the runner from `createDatabase`, `transactions.run(tx => ...)` (the `TRANSACTION_RUNNER` token on Nest, `infra.transactions` on Fastify), passes the transaction handle explicitly to every repository call inside it, and commits or rolls back. Do not use AsyncLocalStorage or request-scoped repositories: a mistake there does not throw, it silently loses atomicity.
- A `run` called from inside another open `run` is refused at once, with an error that names the cause, and answers 500 because it is a bug. It would otherwise take a second connection and wait for a lock its own caller holds, or use up the pool when several requests nest together. Pass the handle down instead. The outer transaction rolls back when the refusal propagates and commits when its callback catches it, and the next `run` works as usual.
- A timer or a promise that the callback starts inherits this refusal for as long as the transaction is open, and it ends with the transaction: code that runs on after the commit may open a transaction of its own. Start work that needs the data only after `run` returns.
- A connection lost inside a `run` fails its statement with an error the classifier answers as 503, and the pool drops the connection.
- A repository method that writes takes the caller's handle as a required parameter. A write that silently falls back to the pool client commits outside the transaction its caller believes it is in.
- A read may default to the pool when no transaction is open.
- Counting or deleting under a lock is the one case where a repository may open its own transaction, when the transaction is the whole operation. Say so in its doc comment, and never call it from inside a `run`.
- Queue and cache side effects run after the transaction commits, because they cannot join it.

```ts
/**
 * Moves stock between two warehouses atomically.
 * @param input - Source and target warehouse, SKU and quantity.
 * @returns Resolves once the transaction has committed and the event is published.
 */
async transfer(input: TransferInput): Promise<void> {
  await this.transactions.run(async (tx) => {
    await this.stockRepository.remove(input.from, input.sku, input.qty, tx);
    await this.stockRepository.add(input.to, input.sku, input.qty, tx);
  });
  await this.events.stockMoved(input); // after commit
}
```

### On a server that went silent

`bounded()` answers at its deadline, and a promise cannot be cancelled, so a statement it abandoned keeps its connection for as long as `data.md` says. The probe of the health route sets `query_timeout` on its own query on the pool, so its connection is dropped at the deadline and probes cannot use up the pool. Drizzle gives a statement of yours no such option, and a `statement_timeout` is enforced by the server, so it does nothing for a server that does not answer.

## Rows and types

### Names and keys

- Tables and columns are snake_case (`page_count`), never camelCase. The schema names each column explicitly; code maps rows to its own convention in the repository, field by field.
- Every table has `id`, `created_at` and `updated_at`. `id` is a `uuid` primary key defaulting to `gen_random_uuid()` and travels as a string on the wire; do not use serial or identity integers as public ids. `created_at` and `updated_at` are `timestamptz` and not null, defaulting to `now()`, and every update sets `updated_at` (in the repository's update statement, or by a trigger).
- There is no soft delete by default: a delete removes the row. A table that needs one adds a nullable `deleted_at timestamptz`, and its repository filters on it everywhere.

```ts
export const orderItems = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id),
  pageCount: integer('page_count').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

### Types and constraints

- Use `timestamptz` for every instant, never a Unix integer and never `timestamp` without a zone. The API carries instants as ISO 8601 strings (`api-and-errors.md`).
- Use `numeric` for money, and `text` over `varchar(n)` unless a limit is a rule.
- Constraints belong in the schema (`notNull`, `unique`, `check`, foreign keys), not only in the application. A unique violation maps to a 409 through the failure table in `api-and-errors.md`.
- Index every foreign key and every column a list endpoint filters or sorts on.
