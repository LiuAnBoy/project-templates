## Database commands

`pnpm db:generate` writes SQL into `drizzle/` from the schema, `pnpm db:migrate` applies what is not recorded, `pnpm db:status` lists what is pending and never writes, `pnpm db:pull` adopts a database that already has tables (once, before the project's first migration), and `pnpm test:integration` runs the store tests against the compose service (start it first, and copy `.env.example` to `.env`). The server refuses to start until `.env` holds `DATABASE_URL`.
