/** Injection token of the dependency checks (`DependencyCheck[]`) the health route and the startup gate run. */
export const DEPENDENCY_CHECKS = Symbol('DEPENDENCY_CHECKS');

/** Injection token of the shared rate-limit storage (`ThrottlerStorage`), or `undefined` for the in-memory default. */
export const RATE_LIMIT_STORAGE = Symbol('RATE_LIMIT_STORAGE');

/** Injection token of the database client (`Database` of `src/db/database.ts`). */
export const DATABASE = Symbol('DATABASE');

/** Injection token of the transaction runner (`TransactionRunner<DatabaseTransaction>`). */
export const TRANSACTION_RUNNER = Symbol('TRANSACTION_RUNNER');

/** Injection token of the Redis client (`Redis` of `ioredis`). */
export const REDIS = Symbol('REDIS');
