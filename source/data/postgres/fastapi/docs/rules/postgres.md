# PostgreSQL: models, migrations, query layer and transactions

PostgreSQL is accessed through SQLAlchemy 2 on `psycopg`, with Alembic for migrations. The SQLAlchemy models own the database schema; migrations are generated from them, reviewed and committed. One source of truth means a schema change is one diff that a reviewer reads in two forms: the models and the migration they produced. The store-neutral rules are in `data.md`; this page adds what is specific to PostgreSQL.

## Connection settings

- The server reads `DATABASE_URL`, a plain `postgresql://` URL whose driver the factory sets, and nothing in code names a host or a credential. A missing value, or a URL the engine cannot be built from (a port that is not a number, an unparsable host), stops the boot naming the variable and never the value. `make db-migrate` and `make db-status` read it through the same settings and refuse such a value with `invalid configuration: DATABASE_URL`.
- In containers (`docker-compose.yml`) compose builds `DATABASE_URL` for `server` and `migrate` from `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE` and the service name, so `.env`'s `DATABASE_URL` serves a server run on the host. `POSTGRES_PASSWORD` must be URL-safe (letters, digits, `-`, `.`, `_`, `~`), because compose cannot encode it. Neither container receives the superuser password as a variable.
- `POSTGRES_DATABASE` is the plain database name. The project's own service creates it, and on a shared server it must name a database that exists there, because compose does not create it.
- `POSTGRES_PORT` is the loopback port of the project's service. To use a shared PostgreSQL server that runs on a docker network, change four lines of `.env` and nothing else: `COMPOSE_FILE` (to `docker-compose.yml:docker-compose.postgres-cluster.yml`), `POSTGRES_DOCKER_NETWORK`, `DATABASE_URL` and `POSTGRES_DATABASE`. Keep `POSTGRES_PASSWORD` set. Restoring `.env` brings the local service back.
- `src/db/database.py` is the one file that names PostgreSQL. It exports `create_database(config)`, which returns the session factory, the transaction runner, a probe and a close, and the `src/infra/` seam calls it once. Never create a second engine.
- `TEST_DATABASE_URL` is read only by `make test-integration`, which refuses a host that is not local.

## Models and migrations

- Models live under `src/db/models/`, one module per aggregate, each imported from `src/db/models/__init__.py` so Alembic's autogenerate sees it. They extend `db.base.Base`, whose naming convention names every constraint. Nothing else defines a table. Write every column name explicitly in snake_case.
- After changing a model run `make db-generate`. It writes a migration into `alembic/versions/` and formats it. Read it in review like code (autogenerate misses renames and some constraints), and commit it together with the model change.
- Never edit an applied migration. Fix forward with a new one generated from the models.
- Destructive changes (drop a column or table, narrow a type) ship in their own migration, after the code that stopped using the thing has been deployed.

## Migration lifecycle

### Baseline

- Before the project's first production deploy there is one baseline. While nothing is deployed, a model change regenerates it: remove the generated revisions and run `make db-generate` again, so the first deploy applies a single revision.
- After the first production deploy the baseline never changes. Every model change is a new generated revision, reviewed and committed.

### Applying and tracking

- Alembic records the applied revision in `alembic_version`; the files in `alembic/versions/` list the revisions that exist. Nothing keeps its own list by hand.
- `make db-migrate` is the only way a shared database changes. It applies only what is not recorded, does nothing when the database is up to date, and prints the counts, the names it applied and the record afterwards, so a deploy log shows which ran instead of a silent success. A failure prints the statement and the cause; a failure to connect prints fixed text and a code, never the host, the user or the database name.
- A database that recorded a revision this checkout does not contain is ahead of it (an older release deployed over a newer one). `make db-migrate` and `make db-status` print a warning, treat nothing as pending, and apply nothing.
- `make db-status` lists the migrations that are still pending and never writes. A project with no table yet has none, and both commands say so. Several heads on disk fail it.
- `make db-generate` compares the models with the database, so the database must be at head. The revision it writes passes `make lint` and `make format-check` for a message with no backslash or triple quote: its imports are sorted and it is formatted, and `alembic/versions/` is exempt from the docstring and line-length rules because the docstring is the message.
- Run `make db-migrate` once per deploy, before the new code starts. Two runners against one database at once are not guarded.

### Branches and heads

Two revisions generated on separate branches both descend from the same parent, so after the merge Alembic reports multiple heads and refuses to upgrade. Resolve them with a merge revision (`alembic merge`) before deploying, and commit it.

## Query layer: SQLAlchemy 2

- Use SQLAlchemy 2 style (`select(...)`, `AsyncSession`) with an async engine. The engine is created through the `src/infra/` seam, connects on first use and is disposed in the app lifespan, not at import.
- Rows map to pydantic models in each module's `schemas.py` or `rows.py`; the repository returns those models, never ORM instances or raw rows.
- Values always travel as bound parameters; never format values into a SQL string. Raw SQL through `text()` is fine in a repository when the query builder cannot express the query.
- The engine hides bound parameters (`hide_parameters`), and the log withholds the message of a driver error that quotes a value or a name (SQLSTATE class 22, such as an invalid UUID; class 23, whose `DETAIL` names the key; class 28 and `3D000`, which name the user and the database) and the message of every connection or TLS failure, which names the host. The statement, the class and the code stay, so the log says what failed and never with what.

## Repositories and transactions

- SQL appears only in repositories. Routers and services never build a query. A query has one place to review and to change when the schema moves.
- The service owns the transaction scope. It opens the transaction with the runner from `create_database`, `transactions.run(work)` (`infra.transactions`), passes the session explicitly to every repository call inside it, and the transaction commits when `work` returns and rolls back when it raises. The commit happens inside the service call, so a commit failure surfaces in the request and becomes a proper failure answer.
- A `run` called from inside another open `run` is refused at once with a `RuntimeError` that names the cause, and answers 500 because it is a bug. It would otherwise take a second connection and wait for a lock its own caller holds, or use up the pool when several requests nest together. Pass the session down instead. The outer transaction rolls back when the refusal propagates and commits when its work catches it, and the next `run` works as usual.
- A task that `work` starts inherits this refusal for as long as the transaction is open, and it ends with the transaction: a task that runs on after the commit may open a transaction of its own. Start one that needs the data only after `run` returns.
- The session ends when `work` settles, before the commit or the rollback (`src/db/session_end.py`). Any later use raises `TransactionEndedError` with fixed text and answers 500: a use from a task left running, a session a repository stored, its synchronous session, and the connection it handed out. It holds no connection, so the pool is untouched.
- Asking a connection for its `driver_connection` makes the pool close that connection when it returns, because the object could otherwise write on the connection after someone else holds it. It costs one reconnect, and a kept one raises the same error. Reach for it only for what SQLAlchemy cannot do, such as `COPY`, and only as `(await connection.get_raw_connection()).driver_connection`: the adapted connection's own attribute of that name goes unseen, and a driver object kept from it stays live.
- A repository method takes the session as its first argument after `self`, per call, and never stores it; one that writes takes the caller's session as a required parameter and never opens a session itself.
- A read-only service method may open a session of `session_factory` without a transaction, always as `async with session_factory() as session`: the session ends with the block, the same way. One that nothing closes holds its connection until the collector drops it, and a warning that names no connection value says so.
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

        Raises:
            ApiError: With code ``out_of_stock`` when a line cannot be reserved.
        """

        async def work(session: AsyncSession) -> OrderRow:
            order = await self._repo.insert(session, user_id, body)
            await self._repo.reserve(session, order.id, body.lines)
            return order

        return await self._transactions.run(work)
```

Tests run the service against a real database, in a throwaway schema of its own; the integration tests pin the target to `TEST_DATABASE_URL` and refuse a non-local host, so a stray shell variable can never point the suite at a real database.

### On a server that went silent

`bounded()` answers at its deadline, also while `psycopg` is busy cancelling. On a cancelled statement `psycopg` sends the server a cancel, waits up to five seconds for that and five more for the statement to end, then closes the connection and logs `query cancellation failed` and `query not terminated after cancellation`. So work that `bounded()` abandoned holds its connection for about ten seconds more. A statement nothing cancelled waits for as long as `data.md` says.

## Rows and types

### Names and keys

- Tables and columns are snake_case (`page_count`), never camelCase. The model names each column explicitly; code maps rows to its own convention in the repository, field by field.
- Every table has `id`, `created_at` and `updated_at`. `id` is a `Uuid` primary key defaulting to `gen_random_uuid()` and travels as a string on the wire; do not use serial or identity integers as public ids. `created_at` and `updated_at` are `DateTime(timezone=True)` and not null, defaulting to `now()`, and every update sets `updated_at` (in the repository's update statement, or by a trigger).
- There is no soft delete by default: a delete removes the row. A table that needs one adds a nullable `deleted_at` `DateTime(timezone=True)` column, and its repository filters on it everywhere.

```python
class OrderItem(Base):
    """One line of an order."""

    __tablename__ = "order_items"

    id: Mapped[UUID] = mapped_column(
        "id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")
    )
    order_id: Mapped[UUID] = mapped_column("order_id", ForeignKey("orders.id"))
    page_count: Mapped[int] = mapped_column("page_count")
    created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), server_default=func.now()
    )
```

### Types and constraints

- Use `DateTime(timezone=True)` (`timestamptz`) for every instant, never a Unix integer and never a timestamp without a zone. The API carries instants as ISO 8601 strings (`api-and-errors.md`).
- Use `Numeric` for money, and `Text` over `String(n)` unless a limit is a rule.
- Constraints belong in the models (`nullable`, `unique`, `CheckConstraint`, foreign keys), not only in the application. A unique violation maps to a 409 through the failure table in `api-and-errors.md`.
- Index every foreign key and every column a list endpoint filters or sorts on.
