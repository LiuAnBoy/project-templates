# Docs to update with a change

This file says which of the project's own pages a kind of backend change must update, in the same change and the same commit as the code. A doc updated later is a doc that drifts. The task-to-doc table in `AGENTS.md` names the real files; where it differs from the names below, `AGENTS.md` wins.

## Map

| Change                                                                           | Update                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New, removed or changed route, request or response shape, status code, auth rule | `docs/apis/README.md` (the route index), the route group's own page under `docs/apis/` (routes, parameters, the real example answer, possible failures), and `docs/apis/conventions.md` when a shared rule or a shipped builder changes |
| New or changed table, column, index, constraint, enum or migration               | `docs/database.md` (schema, relationships, the migration list) and the SQLAlchemy models with its generated migration per `postgres.md`                                                                                                 |
| New module, service boundary, queue, scheduled job, external dependency, cache   | `docs/README.md` (the module list and the request flow)                                                                                                                                                                                 |
| New or changed environment variable or config key                                | `src/core/config.py`, `.env.example` with a fake value, and the commands section of `docs/README.md`                                                                                                                                    |
| New command, script or make target                                               | the `Makefile` and the commands section of `docs/README.md`                                                                                                                                                                             |
| New failure code or message                                                      | the failure table in code (`src/core/errors.py`), the failure table in `docs/apis/conventions.md`, and the failures of the routes that raise it                                                                                         |
| A decision that future work must respect                                         | `AGENTS.md` if it is a standing rule, otherwise the page that owns the topic                                                                                                                                                            |

## Rules

- Open `docs/README.md` (the index of `docs/`) before writing: extend the page that owns the topic; add a new page only for a topic with none, and link it from the index.
- Describe current behaviour as it is now. Do not leave "was", "previously" or "TODO" notes in a page; history belongs in the changelog or the commit.
- Records state only what exists: the route index lists the routes that ship, the database page lists the tables that exist (none yet), nothing planned.
- An API example shows the real envelope from `api-and-errors.md`, with fake data.
- Language: `AGENTS.md` and everything under `docs/rules/` are English. Every other page under `docs/` (index, API, database, and any business page such as a workflow or a backlog) is Traditional Chinese.
- Business pages (workflow, backlog, product rules) are not shipped. A project that needs one adds it under `docs/`, in Traditional Chinese, and links it from `docs/README.md`.
- Docs and the schema go together: when the SQLAlchemy models or `migrations/` changes, the database page, the schema and the committed migration agree, and no applied migration is edited (`postgres.md`).
- A change that alters nothing a reader of these pages relies on (an internal refactor, a test) updates no page; say so in the report rather than touching docs for form.
- Never put a host, port, credential or token in a page; point to where the real value lives (the env file, the secret store).
