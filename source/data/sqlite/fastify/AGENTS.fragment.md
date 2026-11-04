## SQLite on Fastify

Take the database from the infra seam: `createInfra(config)` in `src/infra/infra.ts` returns `db` (the Drizzle client, which only reads) and `transactions`, and `main.ts` passes them to the factories it wires. Every write goes through `transactions.run(tx => ...)`, and the service passes `tx` to each repository call. `createInfra` opens the connections once and its `close` releases them; never open another.
