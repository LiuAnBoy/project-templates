## PostgreSQL on NestJS

Take the database from the global `InfraModule`: inject `DATABASE` (the Drizzle client) into a repository and `TRANSACTION_RUNNER` into a service (`src/infra/tokens.ts`). The service opens the transaction with `TRANSACTION_RUNNER.run(tx => ...)` and passes `tx` to each repository call. `InfraModule` creates the pool once and closes it on shutdown; never create another.
