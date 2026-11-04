## PostgreSQL on Fastify

Take the database from the infra seam: `createInfra(config)` in `src/infra/infra.ts` returns `db` (the Drizzle client) and `transactions`, and `main.ts` passes them to the factories it wires. A service opens the transaction with `transactions.run(tx => ...)` and passes `tx` to each repository call. `createInfra` creates the pool once and its `close` releases it; never create another.
