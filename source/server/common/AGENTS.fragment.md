# Backend server

## Always

- Database naming (`docs/rules/postgres.md`): tables and columns are snake_case, never camelCase; instants are `timestamptz`, never Unix integers; ids are `uuid` defaulting to `gen_random_uuid()`; every table has `id`, `created_at` and `updated_at`; no soft delete by default, a table that needs it adds `deleted_at`.
- SQL lives only in repositories; the service owns the transaction scope. PostgreSQL by default (`docs/rules/postgres.md`).
- Dependency calls on the request path are wrapped in `bounded()`; an unreachable dependency answers 503, not 500.
- Rate limiting is on by default: 300 requests per client per 60 seconds (`RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS`), answered 429 from the failure table. The client is the socket address; a forwarded header counts only from the proxies listed in `TRUST_PROXY`, and nothing else reads that header to decide (`docs/rules/api-and-errors.md`, Rate limiting).
- An API or schema change updates the docs in the same change (`docs/rules/docs-to-update.md`).

## Task to doc

| Task                                                                                     | Read                           |
| ---------------------------------------------------------------------------------------- | ------------------------------ |
| Any answer, error, status code, auth                                                     | `docs/rules/api-and-errors.md` |
| Before writing any API code: the design of every route                                   | `docs/apis/conventions.md`     |
| Structure, configuration, wiring, tests                                                  | `docs/rules/architecture.md`   |
| Schema, migration, query layer, transactions                                             | `docs/rules/postgres.md`       |
| Cache, lock, pub/sub, queue                                                              | `docs/rules/redis.md`          |
| Permissions, duplicates and races, audit, scheduled work, growing tables, trust, outages | `docs/rules/patterns.md`       |
| Which doc a change must update                                                           | `docs/rules/docs-to-update.md` |
| How a request flows, commands, environment variables                                     | `docs/README.md`               |
| Endpoints and their shapes                                                               | `docs/apis/README.md`          |
| Tables                                                                                   | `docs/database.md`             |

## Documents

- `AGENTS.md` and everything under `docs/rules/` are English with no CJK characters. They are the rules.
- Every other page under `docs/` (`README.md`, `apis/`, `database.md`, and any page added later) is Traditional Chinese. These are records of what exists.
- Records state only what exists: the route index lists the routes that ship, the database page lists the tables that exist (none yet), nothing planned.
- Relative links must resolve.
- `docs/rules/` govern all new code. Where code and a rule disagree, fix the code or change the rule in the same change; do not let them drift.
