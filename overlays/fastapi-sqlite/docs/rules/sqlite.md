# SQLite: models, migrations, query layer and transactions

SQLite is accessed through SQLAlchemy 2 on `aiosqlite`, with Alembic for migrations. The SQLAlchemy models own the database schema; migrations are generated from them, reviewed and committed. One source of truth means a schema change is one diff that a reviewer reads in two forms: the models and the migration they produced. The store-neutral rules are in `data.md`; this page adds what is specific to SQLite. SQLite suits one server instance that owns its file; a project that runs several instances against one database chooses a server store instead.

## Connection settings

- The server reads `DATABASE_URL`, the path of the database file, relative to the directory the server starts in. A missing value stops the boot, naming the variable.
- The file must already exist. Only the migration commands (`make db-migrate`, and `make db-generate` while it compares) create it, so a wrong path stops the boot, naming the dependency and never the path, instead of starting an empty database: the store opens the file as a URI with `mode=rw`, and SQLite fails with `SQLITE_CANTOPEN` instead of creating one. `:memory:` is not supported, because the store holds two engines.
- `src/db/database.py` is the one file that names SQLite. It exports `create_database(config)`, which returns the session factory, the transaction runner, a probe and a close, and the `src/infra/` seam calls it once. Never open the file a second time from application code.
- The `data/` folder holds the file and has its own `.gitignore`, so the database is never committed. Back it up with `VACUUM INTO` or the `.backup` command, never by copying the file alone: WAL mode keeps recent writes in the `-wal` file beside it.

## Models and migrations

- Models live under `src/db/models/`, one module per aggregate, each imported from `src/db/models/__init__.py` so Alembic's autogenerate sees it. They extend `db.base.Base`, whose naming convention names every constraint. Nothing else defines a table. Write every column name explicitly in snake_case.
- After changing a model run `make db-generate`. It writes a migration into `alembic/versions/` and formats it. Read it in review like code (autogenerate misses renames and some constraints), and commit it together with the model change. SQLite cannot alter most columns in place, so Alembic runs in batch mode and rebuilds the table: read the generated migration with that in mind.
- Never edit an applied migration. Fix forward with a new one generated from the models.
- Destructive changes (drop a column or table, narrow a type) ship in their own migration, after the code that stopped using the thing has been deployed.

## Migration lifecycle

### Baseline

- Before the project's first production deploy there is one baseline. While nothing is deployed, a model change regenerates it: remove the generated revisions and run `make db-generate` again, so the first deploy applies a single revision.
- After the first production deploy the baseline never changes. Every model change is a new generated revision, reviewed and committed.

### Applying and tracking

- Alembic records the applied revision in `alembic_version`; the files in `alembic/versions/` list the revisions that exist. Nothing keeps its own list by hand.
- `make db-migrate` is the only way the database changes. It applies only what is not recorded, does nothing when the database is up to date, and prints the counts, the names it applied and the record afterwards. A failure prints the statement and the cause; a failure to reach the file prints fixed text and a code, never a path.
- `make db-migrate` runs with foreign keys off and runs `PRAGMA foreign_key_check` afterwards, also when nothing is pending, failing on any violation. A migration that rebuilds a parent table drops it, and with enforcement on the drop silently deletes the child rows that `ON DELETE CASCADE` points at. The check runs after the migration is applied, so a violation means fixing the data in a new migration.
- `make db-status` lists the migrations that are still pending and never writes. A missing file means nothing is applied, and a project with no table yet has nothing pending. Several heads on disk fail it.
- `make db-generate` compares the models with the database, so the database must be at head, and it creates the empty file when it is missing.
- Run `make db-migrate` once per deploy, before the new code starts, while the server is stopped or idle.

### Branches and heads

Two revisions generated on separate branches both descend from the same parent, so after the merge Alembic reports multiple heads and refuses to upgrade. Resolve them with a merge revision (`alembic merge`) before deploying, and commit it.

## Query layer: SQLAlchemy 2

- Use SQLAlchemy 2 style (`select(...)`, `AsyncSession`) on the async engines. The engines are created through the `src/infra/` seam, connect on first use and are disposed in the app lifespan, not at import.
- Rows map to pydantic models in each module's `schemas.py` or `rows.py`; the repository returns those models, never ORM instances or raw rows.
- Values always travel as bound parameters; never format values into a SQL string. Raw SQL through `text()` is fine in a repository when the query builder cannot express the query. The engines hide bound parameters, so a failed statement never prints one.

## Repositories and transactions

- SQL appears only in repositories. Routers and services never build a query. A query has one place to review and to change when the schema moves.
- The service owns the transaction scope. It opens the transaction with the runner from `create_database`, `transactions.run(work)` (`infra.transactions`), passes the session explicitly to every repository call inside it, and the transaction commits when `work` returns and rolls back when it raises. Do not use context variables or request-scoped repositories: a mistake there does not throw, it silently loses atomicity.
- A repository method takes the session as its first argument after `self`; one that writes takes the caller's session as a required parameter. Reads may default to a session of `session_factory`.
- Queue and cache side effects run after `run` returns, because they cannot join the transaction.

```python
class OrderService:
    """Order business rules."""

    def __init__(self, transactions: TransactionRunner, repo: OrderRepository) -> None:
        self._transactions = transactions
        self._repo = repo

    async def place(self, user_id: UUID, body: PlaceOrder) -> OrderRow:
        """Create an order and reserve its stock in one transaction.

        Args:
            user_id: The authenticated user.
            body: The validated request.

        Returns:
            The created order row.
        """

        async def work(session: AsyncSession) -> OrderRow:
            order = await self._repo.insert(session, user_id, body)
            await self._repo.reserve(session, order.id, body.lines)
            return order

        return await self._transactions.run(work)
```

### Two engines

- The store holds two engines. `session_factory` reads through connections that are `query_only`: a write through them fails instead of landing outside a transaction. Every write goes through the runner, and the session the runner passes down is the only writer.
- The runner's engine has one connection, so the writers of this process take turns, and each transaction begins with `BEGIN IMMEDIATE`, so a read-then-write cannot fail on a lock upgrade. A read through `session_factory` does not see work a transaction has not committed, because the database is in WAL mode.
- The wait is bounded: past five seconds a writer fails as a busy store, which answers 503. A lock held by another process fails the same way once `busy_timeout` passes.
- A `run` called from inside another `run` is refused at once, with an error that names the cause, and answers 500 because it is a bug. It would otherwise wait for a connection its own caller holds and stop every write until a restart. Pass the session down instead. The runner stays usable after a refusal or a timeout.
- Keep a transaction short and never await a slow call, such as an HTTP request, inside it: the writing connection is held for the whole `work`.

## Rows and types

### Names and keys

- Tables and columns are snake_case (`page_count`), never camelCase. The model names each column explicitly; code maps rows to its own convention in the repository, field by field.
- Every table has `id`, `created_at` and `updated_at`. `id` is a `String(36)` primary key holding a UUID that the application generates (`str(uuid.uuid4())`) and travels as a string on the wire; do not use autoincrement integers as public ids. `created_at` and `updated_at` are `String` and not null, and every update sets `updated_at` in the repository's update statement.
- There is no soft delete by default: a delete removes the row. A table that needs one adds a nullable `deleted_at` string column, and its repository filters on it everywhere.

```python
class OrderItem(Base):
    """One line of an order."""

    __tablename__ = "order_items"

    id: Mapped[str] = mapped_column("id", String(36), primary_key=True, default=new_id)
    order_id: Mapped[str] = mapped_column("order_id", ForeignKey("orders.id"))
    page_count: Mapped[int] = mapped_column("page_count")
    created_at: Mapped[str] = mapped_column("created_at", String, default=now_iso)
    updated_at: Mapped[str] = mapped_column("updated_at", String, default=now_iso)
```

### Types and constraints

- SQLite has no instant type. Store every instant as an ISO 8601 UTC string in a `String` column (`datetime.now(UTC).isoformat()`), never as a Unix integer, so the value sorts and travels unchanged. The API carries instants as ISO 8601 strings (`api-and-errors.md`).
- Store money as an integer count of the smallest unit, never as a float.
- Foreign keys are enforced because the store turns the pragma on for both engines; declare them in the models anyway.
- Constraints belong in the models (`nullable`, `unique`, `CheckConstraint`, foreign keys), not only in the application. A unique violation maps to a 409 through the failure table in `api-and-errors.md`.
- Index every foreign key and every column a list endpoint filters or sorts on.
