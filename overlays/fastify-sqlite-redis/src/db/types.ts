/**
 * What every SQL store hands out, so a service and its repositories are
 * written once and run on any of them.
 *
 * A store's `database.ts` exports `createDatabase(config)` returning a
 * `DatabasePort`, and nothing else in the project names a store.
 */

/**
 * Runs one unit of work in a transaction.
 *
 * The service owns the scope: it calls `run`, passes the handle to every
 * repository call inside the callback, and the transaction commits when the
 * callback returns and rolls back when it throws. Do not call `run` from inside
 * the callback; pass the handle down instead.
 */
export type TransactionRunner<Tx> = {
  /**
   * @param work - The unit of work; it receives the transaction handle.
   * @returns What `work` returned, once the transaction has committed.
   * @throws Whatever `work` threw, after the rollback.
   */
  run<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
};

/** The database as `createDatabase` returns it. */
export type DatabasePort<Db, Tx> = {
  /** Stable name of the store, used as the name of its dependency check (`postgres`, `sqlite`). */
  name: string;
  /** The query client for reads and for statements that take a handle. */
  db: Db;
  /** The only way to open a transaction. */
  transactions: TransactionRunner<Tx>;
  /** Resolves when the store answers; rejects when it does not. The caller bounds it. */
  probe: () => Promise<void>;
  /** Releases the connections; safe to call twice. */
  close: () => Promise<void>;
};
