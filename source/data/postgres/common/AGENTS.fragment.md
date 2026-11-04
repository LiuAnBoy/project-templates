## PostgreSQL

- Naming and types (`docs/rules/postgres.md`): instants are `timestamptz`, never `timestamp` without a zone and never Unix integers; ids are `uuid` defaulting to `gen_random_uuid()`; `created_at` and `updated_at` are `timestamptz` not null, defaulting to `now()`; a table that needs soft delete adds `deleted_at timestamptz`.
- Schema, migrations, the query layer and transactions follow `docs/rules/postgres.md`. Every write goes through the transaction runner and the service passes the handle down; a `run` inside a `run` is refused at once, so never open a transaction inside a transaction.
- `DATABASE_URL` is required and the only value the server reads; `docker-compose.dev.yml` runs the service in development, and a shared server is reached by changing `.env` alone.
