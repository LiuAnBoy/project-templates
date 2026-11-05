# MySQL: schema, migrations, query layer and transactions

MySQL is accessed through Drizzle and `mysql2`. The Drizzle schema, written in TypeScript, owns the database schema; migrations are SQL files generated from it, reviewed and committed. One source of truth means a schema change is one diff that a reviewer reads in two forms: the TypeScript and the SQL it produced. The store-neutral rules are in `data.md`; this page adds what is specific to MySQL.

This code has no production history. Every claim on this page was run against a real MySQL service by the project's own checks (`mysql:9`, which is 9.7.4, and `mysql:8.4`, which is 8.4.13); none comes from a deployed project.

## Connection settings

- The server reads `DATABASE_URL`, a plain `mysql://` URL, and nothing in code names a host or a credential. A missing value, or a URL the driver cannot read (a port that is not a number, an `ssl` value that is not JSON), stops the boot naming the variable and never the value.
- In containers (`docker-compose.yml`) compose builds `DATABASE_URL` for `server` and `migrate` from `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` and the service name, so `.env`'s `DATABASE_URL` serves a server run on the host. `MYSQL_PASSWORD` must be URL-safe (letters, digits, `-`, `.`, `_`, `~`), because compose cannot encode it.
- The application connects as `MYSQL_USER`, who owns the database `MYSQL_DATABASE` and nothing else. `MYSQL_ROOT_PASSWORD` serves the project's own MySQL service alone, to create that database and user, so compose blanks it in `server` and `migrate`.
- `MYSQL_PORT` is the loopback port of the project's service.
- `src/db/database.ts` is the one file that names MySQL. It exports `createDatabase(config)`, which returns the Drizzle client, the transaction runner, a probe and a close, and the `src/infra/` seam calls it once. Never open a second pool.
- `TEST_DATABASE_URL` is read only by `pnpm test:integration`, which refuses a host that is not local and a query key other than `charset`, `sslmode` and `ssl` (`mysql2` honours `?socketPath=`, which can point anywhere). The application's user cannot create a database, so the tests work in tables with random names and drop them.
- Every connection of the pool starts with `SET time_zone = '+00:00'`, so a default of `CURRENT_TIMESTAMP(3)` is UTC whatever zone the server has. A row inserted from a session set to `+05:00` landed five hours away from one inserted through the factory.
- The factory passes the pool to Drizzle positionally, `drizzle(pool, { schema, mode: 'default' })`. Drizzle 0.45.4 reads the object form `drizzle({ client, mode })` as something else and fails with `client.query is not a function`.

### TLS

- Ask for TLS with the `ssl` key of the URL, whose value is JSON, URL-encoded: `?ssl=%7B%7D` connects over TLS and verifies the certificate against Node's trust store. Against the self-signed certificate of the `mysql:9` image that fails with `HANDSHAKE_SSL_ERROR`; `?ssl=%7B%22rejectUnauthorized%22%3Afalse%7D` connects over TLS without verifying it.
- Never write `sslmode`. `mysql2` prints a warning that it ignores the key, and the connection stays in plain text (`Ssl_cipher` of the session was empty). The settings schema refuses a URL that carries it, and so do `db:migrate`, `db:status` and `db:pull`, with `invalid configuration: DATABASE_URL`.
- `db:migrate` and `db:status` print the code of a failed handshake and no certificate text.

## Schema and migrations

- The schema lives in TypeScript under `src/db/schema/`, one file per aggregate, each exported from `src/db/schema/index.ts`. Nothing else defines a table.
- Write every column name explicitly in snake_case (`datetime('created_at', ...)`), so the SQL names never depend on a casing option.
- After changing the schema run `pnpm db:generate`. It writes SQL into `drizzle/`. Read that SQL in review like code, and commit it together with the schema change.
- Never run `drizzle-kit push` on a shared database: it changes the schema without leaving a migration to review or replay.
- Never edit an applied migration. Fix forward with a new one generated from the schema.
- Destructive changes (drop a column or table, narrow a type) ship in their own migration, after the code that stopped using the thing has been deployed.

## Migration lifecycle

### One DDL statement per migration

- MySQL commits at each DDL statement. An `ALTER TABLE` inside a transaction committed the row inserted before it, and a rollback afterwards kept both the row and the new column.
- The migrator runs a file's statements, split at `--> statement-breakpoint`. When a later statement fails, the earlier ones stay in the database and the migration is not recorded; `db:migrate` prints the failing statement and the code.
- So a migration holds one DDL statement: make one schema change, run `pnpm db:generate`, then make the next. The baseline of a new project runs on an empty database and is the one exception; after a failed run, drop the tables it created and run it again.
- A migration that changed a parent table with `ON DELETE CASCADE` children kept every child row in the trial: `ALTER TABLE` changes the table in place on MySQL.

### Baseline

- Before the project's first production deploy there is one baseline. While nothing is deployed, a schema change regenerates it: remove the generated migrations (the `0000_` SQL file in `drizzle/` and `drizzle/meta/`) and run `pnpm db:generate` again, so the first deploy applies a single file.
- After the first production deploy the baseline never changes. Every schema change is a new generated migration, reviewed and committed.

### Applying and tracking

- Drizzle records what ran in `__drizzle_migrations`, in the database the URL names; `drizzle/meta/_journal.json` lists the migrations that exist. Nothing keeps its own list by hand.
- `pnpm db:migrate` is the only way a shared database changes. It applies only what is not recorded, does nothing when the database is up to date, and prints the counts, the names it applied and the record afterwards, so a deploy log shows which files ran instead of a silent success. It is a plain Node script, so a deploy image without dev dependencies can run it. A failure prints the statement and the code of the database error; a failure to connect prints fixed text and a code, never the host or the user.
- A failed statement never prints a value of your data. A unique index created over rows that hold a duplicate failed with `ER_DUP_ENTRY`, whose own message quotes the duplicate, and the output held the statement and the code and none of the rows.
- `pnpm db:status` lists the migrations that are still pending and never writes. A project with no table yet has none, and both commands say so.
- Run `pnpm db:migrate` once per deploy, before the new code starts. Two runners against one database at once are not guarded.

### Branches and the journal

Drizzle's migrator applies a migration only when its journal `when` is newer than the newest one recorded in the database. A migration generated on a branch and merged after a newer one has already run would be skipped silently, with no error. Both scripts detect that case, name the migration and exit 1. Generate on top of the latest trunk right before merging, and regenerate the migration if the trunk gained one in the meantime.

## Adopting a database that already has tables

A project may connect to a server it does not own, whose tables exist already. Adopt them once, before the project's first migration, with `pnpm db:pull` and `DATABASE_URL` set to that database.

- `db:pull` runs `drizzle-kit pull` and then tidies the result. The schema moves to `src/db/schema/introspected.ts` and, when the tables have foreign keys, `introspected-relations.ts`, both exported from `src/db/schema/index.ts`, with their unused imports dropped and Prettier applied. Drizzle Kit writes the baseline migration and its snapshot into `drizzle/`.
- The baseline Drizzle Kit writes holds the `CREATE TABLE` statements inside one block comment, and `db:migrate` failed on it: the migrator cuts the file at each `--> statement-breakpoint`, which splits the comment, and the server refused the pieces. `db:pull` replaces the baseline with `SELECT 1;`. The tables stay as they are, the schema and the snapshot describe them, and the journal records the baseline once `db:migrate` runs. An empty database does not get these tables from the migrations, so a development database for such a project is a restore of the server's data (see "The way back").
- Right after the pull, `pnpm db:generate` must print `No schema changes`. The pulled schema declares a foreign key inline with `.references()`, which carries no name, so a key the server named itself (`fk_c`, say) made `db:generate` write `DROP FOREIGN KEY` and `ADD CONSTRAINT` under another name, and `db:migrate` applied it. `db:pull` lists such keys. Declare each one with its own name, as the example below shows, and delete the inline `.references()`. With the keys named, `db:generate` printed `No schema changes`.
- Keep the generated tables as they are. Do not force the id or naming rules of this project onto old tables: their integer keys, their column names and their types stay what the server has, and a migration that renames or retypes them is a change to someone else's schema. New tables follow the rules of this page.
- Then work as usual: add a table to the schema, run `pnpm db:generate` and `pnpm db:migrate`. With a legacy table that held rows, this flow left the table's `SHOW CREATE TABLE` output and its rows unchanged and recorded the baseline and the new migration.

A foreign key declared by name, in the table's extra configuration:

```ts
(table) => [
  foreignKey({
    columns: [table.customerId],
    foreignColumns: [legacyCustomers.id],
    name: 'fk_c',
  }).onDelete('cascade'),
],
```

### Before the first migration on a server you do not own

- Check the engine of every table: `select table_name, engine from information_schema.TABLES where table_schema = database() and engine <> 'InnoDB'`. A row written to a MyISAM table inside `transactions.run` stayed after the rollback, so nothing that needs atomicity may touch one.
- The connection speaks `utf8mb4`, and the `mysql:9` image's server default is `utf8mb4` too. Read the character set of an old table before joining it to a new one.
- An `ALTER TABLE` that copies the table refuses `LOCK=NONE` (error 1846, "COPY algorithm requires a lock"), so it blocks writes while it runs; adding a column with `ALGORITHM=INPLACE, LOCK=NONE` was accepted. Run a copying `ALTER` in a window the owners agreed to.

### The way back

A DDL statement cannot be rolled back (above), so the way back to a database is a dump taken before the migration, with `mysqldump`.

- The application's user of the compose service cannot run it: `mysqldump` stopped with error 1227 for lack of the `RELOAD` privilege. Run it as an account that has the right, with `--single-transaction`.
- Rehearse the restore before relying on it. A dump restored into the server it came from stopped at `@@GLOBAL.GTID_PURGED cannot be changed` (error 3546).

## Repositories and transactions

- SQL appears only in repositories. Controllers, routes and services never build a query. A query has one place to review and to change when the schema moves.
- Drizzle builds the queries. Raw SQL through Drizzle's `sql` tag is fine in a repository when the builder cannot express the query.
- The service owns the transaction scope. It opens the transaction with the runner from `createDatabase`, `transactions.run(tx => ...)` (the `TRANSACTION_RUNNER` token on Nest, `infra.transactions` on Fastify), passes the transaction handle explicitly to every repository call inside it, and commits or rolls back. Do not use AsyncLocalStorage or request-scoped repositories: a mistake there does not throw, it silently loses atomicity.
- Create a table outside a transaction: DDL commits the transaction it runs in.
- A `run` called from inside another open `run` is refused at once, with an error that names the cause, and answers 500 because it is a bug. It would otherwise take a second connection and wait for a lock its own caller holds, or use up the pool when several requests nest together. Pass the handle down instead. The outer transaction rolls back when the refusal propagates and commits when its callback catches it, and the next `run` works as usual.
- A timer or a promise that the callback starts inherits this refusal for as long as the transaction is open, and it ends with the transaction: code that runs on after the commit may open a transaction of its own. Start work that needs the data only after `run` returns.
- The handle ends when the callback settles, before the commit or the rollback. Any later use throws `TransactionEndedError` (`src/db/transaction-end.ts`) with fixed text and answers 500: a use from work left running, a handle a repository stored, a builder or a prepared statement made before the end, and `tx.session.client`, which in a transaction exposes only `query` and `execute`. The connection goes back to the pool at the end, and a pool of one served the next `run` at once. `tx.execute(...)` runs the moment it is called, while a select builder runs when it is awaited, so only the builder can outlive the callback. A rejection nothing catches ends the process like any other bug (`data.md`), so await the work you start or catch its failure.
- `tx.transaction(...)` inside a `run` is a savepoint: a failure inside it rolls back to the savepoint and leaves the outer transaction alone.
- A connection lost inside a `run`, killed while a statement ran or between two statements, fails the next statement with an error the classifier answers as 503 (`PROTOCOL_CONNECTION_LOST`, or the fixed text `Can't add new command when connection is in closed state`), and the pool drops the connection.
- A repository method that writes takes the caller's handle as a required parameter, per call, and never stores it. A write that silently falls back to the pool client commits outside the transaction its caller believes it is in.
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

### Reading a large result inside a transaction

`.iterator()` on a handle fails with a `TypeError`: Drizzle's iterator reads the driver's raw connection, and the handle exposes only its checked `query` and `execute`, so nothing can stream past the end of a transaction. Read in pages inside a `run`, or iterate on the pool client outside one.

### When the pool is busy or the server went silent

- `mysql2` has a `queueLimit` that counts waiting calls and no acquire timeout, so with every connection held a further call waits for ever. The factory bounds that wait (5 seconds by default): the call fails with `mysql: no connection became free in time`, which answers 503, and a connection that frees up later is returned unused, so a call that gave up never runs its statement late.
- `bounded()` answers at its deadline, and a promise cannot be cancelled, so a statement it abandoned keeps its connection for as long as `data.md` says. A `timeout` on a `mysql2` query only fails the call with `PROTOCOL_SEQUENCE_TIMEOUT`: the next query on that connection waited for the first one to finish. So the probe of the health route takes a connection of its own and destroys it when its query fails or times out, which frees the slot; a probe against a proxy that stopped answering failed at the deadline and its connection was closed. Drizzle gives a statement of yours no such option.
- A server out of connections answers `ER_CON_COUNT_ERROR` (SQLSTATE `08004`), a pool that was closed answers `Pool is closed.`, and both are outages.

## Rows and types

### Names and keys

- Tables and columns are snake_case (`page_count`), never camelCase. The schema names each column explicitly; code maps rows to its own convention in the repository, field by field.
- Every table has `id`, `created_at` and `updated_at`. `id` is a `CHAR(36)` primary key holding a lower-case UUID that the application generates (`$defaultFn(() => randomUUID())`) and travels as a string on the wire; do not use auto-increment integers as public ids. `created_at` and `updated_at` are `DATETIME(3)` and not null, defaulting to `CURRENT_TIMESTAMP(3)`, and every update sets `updated_at` (`$onUpdate(() => new Date())`, or in the repository's update statement).
- There is no soft delete by default: a delete removes the row. A table that needs one adds a nullable `deleted_at datetime(3)`, and its repository filters on it everywhere.

```ts
export const orderItems = mysqlTable('order_items', {
  id: char('id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  orderId: char('order_id', { length: 36 })
    .notNull()
    .references(() => orders.id),
  pageCount: int('page_count').notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .$onUpdate(() => new Date()),
});
```

`drizzle-kit generate` wrote `char(36)` and `datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)` for this table, and a row inserted through it got a 36-character lower-case id and an `updated_at` that moved forward on update.

### Types and constraints

- Use `datetime('...', { mode: 'date', fsp: 3 })` for every instant, never a Unix integer and never `TIMESTAMP`. The factory's session zone is UTC and Drizzle reads and writes the value as UTC, so a `Date` written as `2026-11-05T01:02:03.456Z` came back as the same millisecond and the column held `2026-11-05 01:02:03.456`. The API carries instants as ISO 8601 strings (`api-and-errors.md`).
- Use `decimal` for money, and give every key column a length (`char`, `varchar`).
- Constraints belong in the schema (`notNull`, `unique`, `check`, foreign keys), not only in the application. A unique violation (`ER_DUP_ENTRY`) maps to a 409 through the failure table in `api-and-errors.md`.
- Index every foreign key and every column a list endpoint filters or sorts on.

## Logs

- A failed statement is logged with its text and the code of the database error, and without its parameters. The message of a `mysql2` error quotes a value (`Duplicate entry '...' for key`, `Incorrect integer value: '...'`, `Incorrect datetime value: '...'`) or names the user or the host, so it is withheld for every code that starts with `ER_`, with or without a statement above it: `ER_DUP_ENTRY`, `ER_TRUNCATED_WRONG_VALUE_FOR_FIELD` (SQLSTATE `HY000`, so the state cannot tell) and `ER_TRUNCATED_WRONG_VALUE` were logged with their codes and none of their values.
- A refused login (`ER_ACCESS_DENIED_ERROR`), a database the user may not open (`ER_DBACCESS_DENIED_ERROR`, which is what the application's user gets for a database that does not exist), `ER_BAD_DB_ERROR` and `HANDSHAKE_SSL_ERROR` are logged with the code alone and answer 503, and these were run against a real server. So are `ER_HOST_NOT_PRIVILEGED`, `ER_HOST_IS_BLOCKED`, `ER_ACCOUNT_HAS_BEEN_LOCKED`, `ER_USER_LIMIT_REACHED`, `ER_TOO_MANY_USER_CONNECTIONS`, `ER_MUST_CHANGE_PASSWORD_LOGIN` and `ER_SERVER_OFFLINE_MODE`, by the classifier's test only: they need a server set up to refuse.
- `db:pull` prints none of Drizzle Kit's output, because its report of a refused login can name the user and the host. `pnpm exec drizzle-kit pull` shows it when you need it.
