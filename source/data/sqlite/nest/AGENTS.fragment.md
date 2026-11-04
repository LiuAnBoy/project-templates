## SQLite on NestJS

Take the database from the global `InfraModule`: inject `DATABASE` (the Drizzle client, which only reads) into a repository and `TRANSACTION_RUNNER` into a service (`src/infra/tokens.ts`). Every write goes through `TRANSACTION_RUNNER.run(tx => ...)`, and the service passes `tx` to each repository call. `InfraModule` opens the connections once and closes them on shutdown; never open another.
