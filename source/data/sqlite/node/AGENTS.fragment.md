## Database commands

`pnpm db:generate` writes SQL into `drizzle/` from the schema, `pnpm db:migrate` applies what is not recorded and creates the database file, `pnpm db:status` lists what is pending and never writes, and `pnpm test:integration` runs the store tests against a database file of their own. Copy `.env.example` to `.env` and run `pnpm db:migrate` before the first start: the server refuses to start without the file.
