# PostgreSQL: models, migrations, query layer and transactions

PostgreSQL is the default database, accessed through SQLAlchemy 2 with Alembic for migrations. The SQLAlchemy models own the database schema; migrations are generated from them, reviewed and committed. One source of truth means a schema change is one diff that a reviewer reads in two forms: the models and the migration they produced.

## Current state

This template ships no database yet: no driver or SQLAlchemy package is installed, there is no `migrations/` directory, and the database page lists no tables. The rules below apply from the first table on. To start:

1. Add SQLAlchemy 2 (with its async support), an async PostgreSQL driver and Alembic (`uv add`, then pin them exactly).
2. Add the models under `src/db/models.py` (or a package), an Alembic environment in `migrations/` whose `env.py` reads `DATABASE_URL` and fails when it is missing, and the Makefile targets `db-generate` (`alembic revision --autogenerate`), `db-migrate` (`alembic upgrade head`, printing the revisions it applied) and `db-status` (lists the pending revisions).
3. Add `DATABASE_URL` to the settings when code reads it, and to `.env.example` with a fake value such as `postgresql+psycopg://app:app@localhost:5432/app`.
4. Record the tables on the database page in the same change.

## Models and migrations

- Models live in one place, `src/db/`, and nothing else defines a table. Write every column name explicitly in snake_case.
- After changing a model run `make db-generate`. It writes a migration into `migrations/versions/`. Read it in review like code (autogenerate misses renames and some constraints), and commit it together with the model change.
- Never edit an applied migration. Fix forward with a new one generated from the models.
- Destructive changes (drop a column or table, narrow a type) ship in their own migration, after the code that stopped using the thing has been deployed.

## Migration lifecycle

### Baseline

- Before the project's first production deploy there is one baseline. While nothing is deployed, a model change regenerates it: remove the generated revisions and run `make db-generate` again, so the first deploy applies a single revision.
- After the first production deploy the baseline never changes. Every model change is a new generated revision, reviewed and committed.

### Applying and tracking

- Alembic records the applied revision in `alembic_version`; the files in `migrations/versions/` list the revisions that exist. Nothing keeps its own list by hand.
- `make db-migrate` is the only way a shared database changes. It applies only what is not recorded, does nothing when the database is up to date, and prints the revisions it applied, so a deploy log shows which ran instead of a silent success.
- `make db-status` lists the revisions that are still pending.
- Run `make db-migrate` once per deploy, before the new code starts. Two runners against one database at once are not guarded.

### Branches and heads

Two revisions generated on separate branches both descend from the same parent, so after the merge Alembic reports multiple heads and refuses to upgrade. Resolve them with a merge revision (`alembic merge`) before deploying, and commit it.

## Query layer: SQLAlchemy 2

- Use SQLAlchemy 2 style (`select(...)`, `AsyncSession`) with an async engine. The engine is created and disposed in the app lifespan, not at import, and stored on `app.state`.
- Rows map to pydantic models in each module's `schemas.py` or `rows.py`; the repository returns those models, never ORM instances or raw rows.
- Values always travel as bound parameters; never format values into a SQL string. Raw SQL through `text()` is fine in a repository when the query builder cannot express the query.

## Repositories and transactions

- SQL appears only in repositories. Routers and services never build a query. A query has one place to review and to change when the schema moves.
- The service owns the transaction scope. It opens `session_factory()` and `session.begin()` itself and passes the session to the repository. The commit happens inside the service call, so a commit failure surfaces in the request and becomes a proper failure answer, instead of raising in a dependency's exit code after the response is built.
- A repository method takes the session as its first argument after `self`; it never opens a session itself for a write.
- A read-only service method may open a session without `begin()`.
- Queue and cache side effects run after the `async with` block ends, because they cannot join the transaction; see `redis.md`.

```python
class OrderService:
    """Order business rules."""

    def __init__(
        self, session_factory: async_sessionmaker[AsyncSession], repo: OrderRepository
    ) -> None:
        self._session_factory = session_factory
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
        async with self._session_factory() as session, session.begin():
            order = await self._repo.insert(session, user_id, body)
            await self._repo.reserve(session, order.id, body.lines)
        return order
```

Tests run the service against a real database inside a session whose transaction rolls back after each test; pin the test database name in the fixture and refuse a non-local host, so a stray shell variable can never point the suite at a real database.

## Rows and types

### Names and keys

- Tables and columns are snake_case (`page_count`), never camelCase. Python is snake_case already, so a row maps to its model without renaming.
- Every table has `id`, `created_at` and `updated_at`. `id` is a `uuid` primary key defaulting to `gen_random_uuid()` and travels as a string on the wire; do not use serial or identity integers as public ids. `created_at` and `updated_at` are `timestamptz NOT NULL DEFAULT now()`, and every update sets `updated_at` (in the repository's update statement, or by a trigger).
- There is no soft delete by default: a delete removes the row. A table that needs one adds a nullable `deleted_at timestamptz`, and its repository filters on it everywhere.

```python
class OrderItem(Base):
    """One line of an order."""

    __tablename__ = "order_items"
    __table_args__ = (CheckConstraint("page_count > 0"),)

    id: Mapped[UUID] = mapped_column("id", primary_key=True, server_default=func.gen_random_uuid())
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

- Use `timestamptz` for every instant, never a Unix integer and never `timestamp` without a zone. The API carries instants as ISO 8601 strings (`api-and-errors.md`).
- Use `numeric` for money, and `text` over `varchar(n)` unless a limit is a rule.
- Constraints belong in the schema (`NOT NULL`, `UNIQUE`, `CHECK`, foreign keys), not only in the application. A unique violation maps to a 409 through the failure table in `api-and-errors.md`.
- Index every foreign key and every column a list endpoint filters or sorts on.
