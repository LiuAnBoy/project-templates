## Data

No store is installed. The server boots with no `.env` and an empty environment, `docs/database.md` lists no tables, and `GET /api/health` runs no dependency check.

A store is chosen once, when the project is created, by extracting a data overlay over this template. The overlay brings its own rule page, its connection settings (required, validated at boot), its dependency checks in `src/infra/` and its documents. The naming and transaction rules in `docs/rules/data.md` apply from the first table on, whichever store it is.
