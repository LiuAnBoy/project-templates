## PostgreSQL

- Naming and types (`docs/rules/postgres.md`): instants are `timestamptz`, never `timestamp` without a zone and never Unix integers; ids are `uuid` defaulting to `gen_random_uuid()`; `created_at` and `updated_at` are `timestamptz` not null, defaulting to `now()`; a table that needs soft delete adds `deleted_at timestamptz`.
- Schema, migrations, the query layer and transactions follow `docs/rules/postgres.md`; use the rule page for the task "Schema, migration, query layer, transactions".
