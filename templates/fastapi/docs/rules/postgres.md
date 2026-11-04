# PostgreSQL: migrations, the runner, query layer and transactions

PostgreSQL is the default database. The schema is owned by hand-written SQL files and one runner that records which ran. No ORM and no ORM migration tool owns the schema. One style means one runner, one review habit and a deploy that depends only on the repo.

## Current state

This template ships no database: no driver is installed, there is no `db/` directory, and the database page lists no tables. The rules below apply from the first table on. To start:

1. Create `db/init.sql`, an empty `db/migrations/`, and copy `docs/rules/templates/migrate.sh` to `db/migrate.sh`; each project carries its own copy.
2. Wrap the runner as `make migrate`, a Makefile target that runs `bash db/migrate.sh`.
3. Add psycopg 3 with its pool (`uv add`, then pin it exactly), as described below.
4. Add `DATABASE_URL` to the env schema when code reads it, and to `.env.example` with a fake value such as `postgresql://app:app@localhost:5432/app`. The runner needs bash 3.2+, psql 14+ (and `pg_dump` for the check), and `sha256sum` or `shasum`.
5. Record the tables on the database page in the same change.

## Layout

```text
db/init.sql                  full schema of a new environment
db/migrations/               YYYYMMDD_00X_<name>.sql
db/migrate.sh                a copy of docs/rules/templates/migrate.sh
```

## Migration files

- Name: `YYYYMMDD_00X_<name>.sql` (date, a three-digit sequence for that day, a short name). A file in `db/migrations/` with any other name stops the run before any file applies.
- Files apply in name order, so the date and sequence are the order. Never edit an applied file: the runner records a checksum and refuses to run when an applied file changed. Fix forward with a new file.
- Every file is rerunnable: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and data changes guarded so a second run changes nothing (`WHERE` the target state is not yet true, `ON CONFLICT DO NOTHING`). Reason: a half-known environment or a restored backup can replay a file safely.
- A file stays inside the runner's transaction. Not allowed:
  - transaction control at the top level of a file (`BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT` and the like);
  - a psql backslash command, or a statement starting with a psql variable;
  - a statement that cannot run in a transaction (`CREATE INDEX CONCURRENTLY`, `DROP INDEX CONCURRENTLY`, `VACUUM`);
  - a change to how strings are lexed (`standard_conforming_strings`, `backslash_quote`, `set_config`, `RESET ALL`).

  A `DO $$ BEGIN ... END $$` block, a `BEGIN ATOMIC` function body and `REFRESH MATERIALIZED VIEW CONCURRENTLY` are fine.

- The runner wraps each file and its `public.schema_migrations` row in one transaction and enforces the rule. Before anything applies, it scans `init.sql` and every pending file and refuses a violation. A file written in good faith therefore either applies with its row or leaves neither. The scan guards against mistakes, not against a file built to evade it. If a file does commit part of itself, the runner says so ("committed outside the runner's transaction") and never claims a rollback the server did not confirm.
- Destructive changes (drop a column or table, narrow a type) ship in their own file, after the code that stopped using the thing has been deployed.

## `init.sql` before and after the first production deploy

- Before a project's first production deploy there is nothing to migrate: every schema change goes straight into `init.sql`, and `db/migrations/` stays empty.
- After the first production deploy each change is a new migration file, and `init.sql` is updated to the final schema in the same change. Reason: a new environment runs `init.sql` and then every migration, so both must describe the same schema.

## Running the runner

Modes:

- `bash db/migrate.sh` (same as `apply`): applies every migration not yet recorded. A database without `public.schema_migrations` is a new environment: `init.sql` runs first, then every migration, each recorded.
- `bash db/migrate.sh check <previous-init.sql>`: the schema check, below.

Connection: `DATABASE_URL` (a `postgresql://` URL) when set, otherwise the libpq `PG*` variables (`PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`). The script holds no default host, port or credential. Exit codes: 0 success, 1 failure or schema difference, 2 usage error.

One runner per deploy: two runners against one database at once are not guarded.

## The schema check, in review

The check proves that `init.sql` and the migrations agree. It builds one empty scratch database from the previous `init.sql` plus every migration and another from the new `init.sql`, and their `pg_dump --schema-only` output must match. It applies only after the project's first production deploy, and then it runs whenever a change touches `db/`. Before that deploy `db/migrations/` is empty and `init.sql` is the only schema source, so there is nothing to compare and the check is not run.

```bash
git show master:db/init.sql > /tmp/prev_init.sql   # the trunk's init.sql (use main when that is the trunk)
bash db/migrate.sh check /tmp/prev_init.sql
```

Rules for the check:

- The role needs `CREATEDB`: both scratch databases are created on the target server. Point it at a development server, never a production one.
- Scratch names are `migrate_check_<random>_prev` and `_new`. `MIGRATE_SCRATCH_SUFFIX` replaces the random part when set (letters, digits, `_`); tests use it to force a collision.
- On exit, failure included, it drops only the databases whose `CREATE` succeeded in this run. A name that already exists makes the check fail and that database is left alone.
- A `DATABASE_URL` whose query string carries a `dbname` parameter (any case, or percent-encoded) is refused, because it would override the scratch database name. Leave `dbname` out of the query.

## Query layer: psycopg 3, hand-written SQL

- psycopg 3 with `AsyncConnectionPool(open=False)` from `psycopg_pool`, rows as `dict_row`. The pool is opened and closed in the app lifespan, not at import, and stored on `app.state`.
- Rows map to pydantic models in each module's `rows.py`; the repository returns those models, never raw dicts.
- All SQL is parameterised (`%s` placeholders with a parameter tuple); never format values into the string.

```python
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Open the pool on startup and close it on shutdown.

    Args:
        app: The application instance; the pool is stored on its state.

    Yields:
        Control to the running application.
    """
    pool = AsyncConnectionPool(settings.database_url, open=False, kwargs={"row_factory": dict_row})
    await pool.open(wait=True)
    app.state.pool = pool
    try:
        yield
    finally:
        await pool.close()
```

## Repositories and transactions

- SQL appears only in repositories. Routers and services never build a query. A query has one place to review and to change when the schema moves.
- The service owns the transaction scope. It opens `pool.connection()` and `conn.transaction()` itself and passes the connection to the repository. The commit happens inside the service call, so a commit failure surfaces in the request and becomes a proper failure answer, instead of raising in a dependency's exit code after the response is built.
- A repository method takes the connection as its first argument after `self`; it never calls `pool.connection()` itself for a write.
- A read-only service method may open `pool.connection()` without `transaction()`.
- Queue and cache side effects run after the `async with` block ends, because they cannot join the transaction; see `redis.md`.

```python
class OrderService:
    """Order business rules."""

    def __init__(self, pool: AsyncConnectionPool, repo: OrderRepository) -> None:
        self._pool = pool
        self._repo = repo

    async def place(self, user_id: int, body: PlaceOrder) -> OrderRow:
        """Create an order and reserve its stock in one transaction.

        Args:
            user_id: The authenticated user.
            body: The validated request.

        Returns:
            The created order row.

        Raises:
            ApiError: With code ``out_of_stock`` when a line cannot be reserved.
        """
        async with self._pool.connection() as conn, conn.transaction():
            order = await self._repo.insert(conn, user_id, body)
            await self._repo.reserve(conn, order.id, body.lines)
        return order
```

Tests run the service against a real database inside a connection that rolls back after each test; pin the test database name in the fixture and refuse a non-local host, so a stray shell variable can never point the suite at a real database.

## Rows and types

- Use `timestamptz` for instants, `numeric` for money, `uuid` or `bigint` identity keys, and `text` over `varchar(n)` unless a limit is a rule.
- Constraints belong in the schema (`NOT NULL`, `UNIQUE`, `CHECK`, foreign keys), not only in the application. A unique violation maps to a 409 through the failure table in `api-and-errors.md`.
- Index every foreign key and every column a list endpoint filters or sorts on.
