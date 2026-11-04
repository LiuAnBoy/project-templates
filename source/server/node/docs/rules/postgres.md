# PostgreSQL: schema, migrations, query layer and transactions

PostgreSQL is the default database, accessed through Drizzle. The Drizzle schema, written in TypeScript, owns the database schema; migrations are SQL files generated from it, reviewed and committed. One source of truth means a schema change is one diff that a reviewer reads in two forms: the TypeScript and the SQL it produced.

## Current state

This template ships no database yet: no driver or Drizzle package is installed, there is no `drizzle/` directory, and the database page lists no tables. The rules below apply from the first table on. To start:

1. Install `drizzle-orm`, a PostgreSQL driver and `drizzle-kit` (a dev dependency), and pin them exactly.
2. Add `drizzle.config.ts`, which reads `DATABASE_URL` from the environment and fails when it is missing, with the schema in `src/db/schema/` and the output folder `drizzle/`.
3. Add the scripts `db:generate` (`drizzle-kit generate`), `db:migrate` (a script in the repo that applies `drizzle/` through Drizzle's migrator and prints the names it applied) and `db:status` (lists the pending migrations).
4. Add `DATABASE_URL` to the env schema when code reads it, and to `.env.example` with a fake value such as `postgresql://app:app@localhost:5432/app`.
5. Record the tables on the database page in the same change.

## Schema and migrations

- The schema lives in TypeScript under `src/db/schema/`, one file per aggregate. Nothing else defines a table.
- Write every column name explicitly in snake_case (`timestamp('created_at', ...)`), so the SQL names never depend on a casing option.
- After changing the schema run `pnpm db:generate`. It writes SQL into `drizzle/`. Read that SQL in review like code, and commit it together with the schema change.
- Never run `drizzle-kit push` on a shared database: it changes the schema without leaving a migration to review or replay.
- Never edit an applied migration. Fix forward with a new one generated from the schema.
- Destructive changes (drop a column or table, narrow a type) ship in their own migration, after the code that stopped using the thing has been deployed.

## Migration lifecycle

### Baseline

- Before the project's first production deploy there is one baseline. While nothing is deployed, a schema change regenerates it: remove the generated migrations (the `0000_init` SQL file in `drizzle/` and `drizzle/meta/`) and run `pnpm db:generate` again, so the first deploy applies a single file.
- After the first production deploy the baseline never changes. Every schema change is a new generated migration, reviewed and committed.

### Applying and tracking

- Drizzle records what ran in `drizzle.__drizzle_migrations`; `drizzle/meta/_journal.json` lists the migrations that exist. Nothing keeps its own list by hand.
- `pnpm db:migrate` is the only way a shared database changes. It applies only what is not recorded, does nothing when the database is up to date, and prints the names it applied, so a deploy log shows which files ran instead of a silent success.
- `pnpm db:status` lists the migrations that are still pending.
- Run `pnpm db:migrate` once per deploy, before the new code starts. Two runners against one database at once are not guarded.

### Branches and the journal

Drizzle's migrator applies a migration only when its journal `when` is newer than the newest one recorded in the database. A migration generated on a branch and merged after a newer one has already run is therefore skipped silently, with no error. Generate on top of the latest trunk right before merging, and regenerate the migration if the trunk gained one in the meantime.

## Repositories and transactions

- SQL appears only in repositories. Controllers, routes and services never build a query. A query has one place to review and to change when the schema moves.
- Drizzle builds the queries. Raw SQL through Drizzle's `sql` tag is fine in a repository when the builder cannot express the query.
- The service owns the transaction scope. It opens the transaction with a small injectable `TransactionRunner.run(tx => ...)` that wraps Drizzle's `db.transaction`, passes the transaction handle explicitly to every repository call inside it, and commits or rolls back. Do not use AsyncLocalStorage or request-scoped repositories: a mistake there does not throw, it silently loses atomicity.
- A repository method that writes takes the caller's handle as a required parameter. A write that silently falls back to the pool client commits outside the transaction its caller believes it is in.
- A read may default to the pool when no transaction is open.
- Counting or deleting under a lock is the one case where a repository may open its own transaction, when the transaction is the whole operation. Say so in its doc comment.
- Queue and cache side effects run after the transaction commits, because they cannot join it; see `redis.md`.

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
