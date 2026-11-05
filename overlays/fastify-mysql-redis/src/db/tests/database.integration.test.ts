import { randomUUID } from 'node:crypto';
import { createServer, Socket } from 'node:net';
import type { AddressInfo } from 'node:net';

import { sql } from 'drizzle-orm';
import { char, datetime, mysqlTable } from 'drizzle-orm/mysql-core';
import { createConnection } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isDependencyOutage } from '../../common/errors/dependency-failure.js';
import { describeFailure } from '../../common/errors/failure.js';
import { openStore } from '../../../scripts/db/adapter.mjs';
import {
  describeMigrateFailure,
  runMigrate,
  runStatus,
} from '../../../scripts/db/runner.mjs';
import { createDatabase, type DatabaseTransaction } from '../database.js';
import {
  TRANSACTION_ENDED_MESSAGE,
  TransactionEndedError,
} from '../transaction-end.js';
import {
  createProbe,
  randomTableName,
  testTarget,
  type Probe,
  type TestTarget,
} from './support.js';

/**
 * Changes one query key of a URL.
 *
 * @param base - The URL to start from.
 * @param key - The query key.
 * @param value - Its value.
 * @returns The new URL.
 */
function withQuery(base: string, key: string, value: string): string {
  const url = new URL(base);
  url.searchParams.set(key, value);
  return url.toString();
}

describe('mysql database', () => {
  let target: TestTarget;
  let database: ReturnType<typeof createDatabase>;
  let probe: Probe;

  beforeAll(async () => {
    target = await testTarget();
    database = createDatabase({ DATABASE_URL: target.url });
    probe = await createProbe(database);
  });
  afterAll(async () => {
    await probe.drop();
    await database.close();
    await target.dispose();
  });

  it('answers the probe', async () => {
    await expect(database.probe()).resolves.toBeUndefined();
  });

  it('commits when the work returns', async () => {
    await database.transactions.run((tx) => probe.insert(tx, 'committed'));

    expect(await probe.exists(database.db, 'committed')).toBe(true);
  });

  it('rolls back when the work throws, and rethrows its error', async () => {
    await expect(
      database.transactions.run(async (tx) => {
        await probe.insert(tx, 'rolled-back');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await probe.exists(database.db, 'rolled-back')).toBe(false);
  });

  it('lets a repository write see its own transaction and hides it from outside until commit', async () => {
    await database.transactions.run(async (tx) => {
      await probe.insert(tx, 'inside');

      expect(await probe.exists(tx, 'inside')).toBe(true);
      expect(await probe.exists(database.db, 'inside')).toBe(false);
    });

    expect(await probe.exists(database.db, 'inside')).toBe(true);
  });

  it('refuses a nested run at once, and stays usable', async () => {
    const outcome = await database.transactions
      .run(async () => {
        await database.transactions.run(() => Promise.resolve());
      })
      .catch((error: unknown) => error);

    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toMatch(
      /pass the transaction handle down/,
    );
    await database.transactions.run((tx) => probe.insert(tx, 'after-nested'));
    expect(await probe.exists(database.db, 'after-nested')).toBe(true);
  });

  it('reproduces the self-deadlock of a nested run on a row the outer transaction wrote: the nested call is refused, the outer rolls back', async () => {
    const outcome = await database.transactions
      .run(async (tx) => {
        await probe.insert(tx, 'self-deadlock');
        await database.transactions.run((inner) =>
          probe.insert(inner, 'self-deadlock'),
        );
      })
      .catch((error: unknown) => error);

    expect((outcome as Error).message).toMatch(
      /pass the transaction handle down/,
    );
    expect(await probe.exists(database.db, 'self-deadlock')).toBe(false);
  });

  it('commits the outer transaction when it catches the refusal of a nested run', async () => {
    await database.transactions.run(async (tx) => {
      await probe.insert(tx, 'outer-survives');
      await database.transactions
        .run(() => Promise.resolve())
        .catch(() => undefined);
    });

    expect(await probe.exists(database.db, 'outer-survives')).toBe(true);
  });

  it('reproduces twelve concurrent nested calls: each is refused at once and the pool still serves a later run', async () => {
    const started = Date.now();

    const outcomes = await Promise.all(
      Array.from({ length: 12 }, () =>
        database.transactions
          .run(async () => {
            await database.transactions.run(() => Promise.resolve());
          })
          .catch((error: unknown) => error),
      ),
    );

    expect(Date.now() - started).toBeLessThan(2000);
    for (const outcome of outcomes) {
      expect((outcome as Error).message).toMatch(
        /pass the transaction handle down/,
      );
    }
    await database.transactions.run((tx) => probe.insert(tx, 'after-twelve'));
    expect(await probe.exists(database.db, 'after-twelve')).toBe(true);
  });

  it('reproduces a timer set inside a run that fires after it ended: it opens its own transaction', async () => {
    let late: Promise<void> | undefined;

    await database.transactions.run(() => {
      late = new Promise((resolve) => setTimeout(resolve, 20)).then(() =>
        database.transactions.run((tx) => probe.insert(tx, 'timer-after')),
      );
      return Promise.resolve();
    });
    await late;

    expect(await probe.exists(database.db, 'timer-after')).toBe(true);
  });

  it('refuses work started inside a run while it is still open', async () => {
    let during: Promise<unknown> | undefined;

    await database.transactions.run(async () => {
      during = database.transactions
        .run(() => Promise.resolve())
        .catch((error: unknown) => error);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(((await during) as Error).message).toMatch(
      /pass the transaction handle down/,
    );
  });

  it('reproduces a connection killed inside a run: the run fails as an outage, the process stays up and the next run works', async () => {
    const killer = createDatabase({ DATABASE_URL: target.url });
    const marker = `sleep_kill_${Date.now()}`;
    const running = database.transactions
      .run((tx) => tx.execute(sql.raw(`select sleep(10) as ${marker}`)))
      .catch((caught: unknown) => caught);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const [rows] = (await killer.db.execute(
      sql.raw(
        `select id from information_schema.PROCESSLIST where info like '%${marker}%' and id <> connection_id()`,
      ),
    )) as unknown as [{ id: number | string }[]];
    for (const row of rows) {
      await killer.db.execute(sql.raw(`kill ${Number(row.id)}`));
    }
    const error = await running;
    await killer.close();

    expect(isDependencyOutage(error)).toBe(true);
    await database.transactions.run((tx) => probe.insert(tx, 'after-kill'));
    expect(await probe.exists(database.db, 'after-kill')).toBe(true);
  });

  it('reproduces a connection killed between two statements of a run: the next statement fails as an outage and the process stays up', async () => {
    const killer = createDatabase({ DATABASE_URL: target.url });
    const error = await database.transactions
      .run(async (tx) => {
        const [rows] = (await tx.execute(
          sql`select connection_id() as id`,
        )) as unknown as [{ id: number | string }[]];
        await killer.db.execute(sql.raw(`kill ${Number(rows[0]?.id)}`));
        await new Promise((resolve) => setTimeout(resolve, 300));
        await probe.insert(tx, 'between-statements');
      })
      .catch((caught: unknown) => caught);
    await killer.close();

    expect(isDependencyOutage(error)).toBe(true);
    await database.transactions.run((tx) => probe.insert(tx, 'after-between'));
    expect(await probe.exists(database.db, 'after-between')).toBe(true);
  });

  describe('a handle used after its run ended', () => {
    /** Runs a transaction that commits, and gives back the handle the work kept. */
    const keptHandle = async (): Promise<DatabaseTransaction> => {
      let kept: DatabaseTransaction | undefined;
      await database.transactions.run((tx) => {
        kept = tx;
        return Promise.resolve();
      });
      return kept as DatabaseTransaction;
    };

    it('throws the fixed error, classified as no outage', async () => {
      const tx = await keptHandle();

      const error = await probe
        .insert(tx, 'after-commit')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(TransactionEndedError);
      expect((error as Error).message).toBe(TRANSACTION_ENDED_MESSAGE);
      expect(isDependencyOutage(error)).toBe(false);
      expect(JSON.stringify(describeFailure(error))).toContain(
        TRANSACTION_ENDED_MESSAGE,
      );
      expect(await probe.exists(database.db, 'after-commit')).toBe(false);
    });

    it('reproduces a write after the rollback: it never commits', async () => {
      let kept: DatabaseTransaction | undefined;
      await database.transactions
        .run((tx) => {
          kept = tx;
          return Promise.reject(new Error('boom'));
        })
        .catch(() => undefined);

      await expect(
        probe.insert(kept as DatabaseTransaction, 'after-rollback'),
      ).rejects.toBeInstanceOf(TransactionEndedError);
      expect(() => (kept as DatabaseTransaction).rollback()).toThrow(
        TransactionEndedError,
      );

      expect(await probe.exists(database.db, 'after-rollback')).toBe(false);
    });

    it('refuses a query builder and a prepared statement made before the end', async () => {
      let built: PromiseLike<unknown> | undefined;
      let prepared: { execute: () => Promise<unknown> } | undefined;
      await database.transactions.run((tx) => {
        // `tx.execute` runs at once on MySQL; a builder runs when it is awaited.
        built = tx.select({ one: sql`1` }).from(sql`(select 1) as t`);
        prepared = tx
          .select({ one: sql`1` })
          .from(sql`(select 1) as t`)
          .prepare();
        return Promise.resolve();
      });

      await expect(built).rejects.toBeInstanceOf(TransactionEndedError);
      await expect(prepared?.execute()).rejects.toBeInstanceOf(
        TransactionEndedError,
      );
    });

    it('refuses the raw client reachable from the handle, kept before the end', async () => {
      let client:
        | {
            query: (text: string) => Promise<unknown>;
            execute: (text: string) => Promise<unknown>;
            release?: unknown;
          }
        | undefined;
      await database.transactions.run((tx) => {
        client = (tx as unknown as { session: { client: typeof client } })
          .session.client;
        return Promise.resolve();
      });

      expect(client?.release).toBeUndefined();
      expect(() => client?.query('select 1')).toThrow(TransactionEndedError);
      expect(() => client?.execute('select 1')).toThrow(TransactionEndedError);
    });

    it('gives work still running when the run ends the same error, stored in a repository too', async () => {
      class Repository {
        constructor(readonly tx: DatabaseTransaction) {}
        write(): Promise<void> {
          return probe.insert(this.tx, 'from-repository');
        }
      }
      let late: Promise<unknown> | undefined;

      await database.transactions.run((tx) => {
        const repository = new Repository(tx);
        late = new Promise((resolve) => setTimeout(resolve, 20))
          .then(() => repository.write())
          .catch((caught: unknown) => caught);
        return Promise.resolve();
      });

      expect(await late).toBeInstanceOf(TransactionEndedError);
      expect(await probe.exists(database.db, 'from-repository')).toBe(false);
    });

    it('keeps savepoints, the error of a kept savepoint handle and an ordinary rollback working', async () => {
      await database.transactions.run(async (tx) => {
        await probe.insert(tx, 'outer-kept');
        await tx
          .transaction(async (inner) => {
            await probe.insert(inner, 'inner-dropped');
            throw new Error('inner');
          })
          .catch(() => undefined);
      });

      expect(await probe.exists(database.db, 'outer-kept')).toBe(true);
      expect(await probe.exists(database.db, 'inner-dropped')).toBe(false);
    });

    it('returns the connection to the pool: a pool of one serves the next run at once', async () => {
      const single = createDatabase(
        { DATABASE_URL: target.url },
        { connectionLimit: 1, acquireTimeoutMs: 1500 },
      );
      let kept: DatabaseTransaction | undefined;
      await single.transactions.run((tx) => {
        kept = tx;
        return Promise.resolve();
      });
      await probe
        .insert(kept as DatabaseTransaction, 'stale')
        .catch(() => undefined);

      const started = Date.now();
      await single.transactions.run((next) =>
        probe.insert(next, 'after-stale'),
      );
      await single.close();

      expect(Date.now() - started).toBeLessThan(1000);
      expect(await probe.exists(database.db, 'after-stale')).toBe(true);
    });
  });

  describe('instants and ids on the wire', () => {
    const name = randomTableName('wire');
    const wire = mysqlTable(name, {
      id: char('id', { length: 36 }).primaryKey(),
      at: datetime('at', { mode: 'date', fsp: 3 }).notNull(),
      createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
        .notNull()
        .default(sql`CURRENT_TIMESTAMP(3)`),
    });

    beforeAll(async () => {
      await database.db.execute(
        sql`create table ${sql.identifier(name)} (id char(36) primary key, at datetime(3) not null, created_at datetime(3) not null default current_timestamp(3))`,
      );
    });
    afterAll(async () => {
      await database.db.execute(sql`drop table ${sql.identifier(name)}`);
    });

    it('round-trips a lower-case UUID and the same UTC millisecond', async () => {
      const id = randomUUID();
      const at = new Date('2026-11-05T01:02:03.456Z');

      await database.db.insert(wire).values({ id, at });
      const [row] = await database.db.select().from(wire);
      const [raw] = (await database.db.execute(
        sql`select at from ${sql.identifier(name)}`,
      )) as unknown as [{ at: string | Date }[]];

      expect(row?.id).toBe(id);
      expect(row?.id).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
      expect(row?.at.toISOString()).toBe('2026-11-05T01:02:03.456Z');
      expect(String(raw?.[0]?.at)).toContain('2026-11-05 01:02:03.456');
    });

    it('stores a CURRENT_TIMESTAMP(3) default as UTC, whatever zone the session would have', async () => {
      await database.db
        .insert(wire)
        .values({ id: randomUUID(), at: new Date() });
      const rows = await database.db.select().from(wire);
      const stored = rows.at(-1)?.createdAt as Date;
      expect(Math.abs(stored.getTime() - Date.now())).toBeLessThan(10_000);

      // The same insert on a session in another zone lands hours away, which is
      // what the connection setting of the factory prevents.
      const other = await createConnection({ uri: target.url });
      await other.query("SET time_zone = '+05:00'");
      await other.query(
        `insert into \`${name}\` (id, at) values (?, '2026-01-01 00:00:00.000')`,
        [randomUUID()],
      );
      await other.end();
      const all = await database.db.select().from(wire);
      const skewed = all.map((r) => r.createdAt.getTime() - Date.now());
      expect(skewed.some((ms) => Math.abs(ms - 5 * 3_600_000) < 60_000)).toBe(
        true,
      );
    });
  });

  it('logs the code and not the quoted value of a rejected value under a failed statement', async () => {
    const table = sql.identifier(probe.name);
    await database.db.execute(
      sql`alter table ${table} add column n int null, add column u varchar(40) null unique, add column d datetime(3) null`,
    );
    await database.db.execute(
      sql`insert into ${table} (id, u) values (${'uq-1'}, ${'DUP-SENTINEL-1'})`,
    );

    const statements = {
      ER_DUP_ENTRY: sql`insert into ${table} (id, u) values (${'uq-2'}, ${'DUP-SENTINEL-1'})`,
      ER_TRUNCATED_WRONG_VALUE_FOR_FIELD: sql`insert into ${table} (id, n) values (${'n-1'}, ${'INT-SENTINEL-2'})`,
      ER_TRUNCATED_WRONG_VALUE: sql`insert into ${table} (id, d) values (${'d-1'}, ${'DATE-SENTINEL-3'})`,
    };
    for (const [code, statement] of Object.entries(statements)) {
      const error = await database.db
        .execute(statement)
        .catch((caught: unknown) => caught);

      const failure = JSON.stringify(describeFailure(error));
      expect(failure).toContain(`"code":"${code}"`);
      expect(failure).not.toMatch(/SENTINEL/);
      expect(isDependencyOutage(error)).toBe(false);
    }
  });

  it('fails the probe on a closed pool, as an outage', async () => {
    const closed = createDatabase({ DATABASE_URL: target.url });
    await closed.probe();
    await closed.close();

    const error = await closed.probe().catch((caught: unknown) => caught);

    expect(isDependencyOutage(error)).toBe(true);
    await expect(closed.close()).resolves.toBeUndefined();
  });

  it('reproduces a rejected login and a database the user may not open: the log names neither the user nor the database, and keeps the code', async () => {
    const url = new URL(target.url);
    const wrongUser = new URL(url);
    wrongUser.username = 'canary-user';
    wrongUser.password = 'canary-pw';
    const wrongDatabase = new URL(url);
    wrongDatabase.pathname = '/canary-db';

    for (const [candidate, code] of [
      [wrongUser, 'ER_ACCESS_DENIED_ERROR'],
      [wrongDatabase, 'ER_DBACCESS_DENIED_ERROR'],
    ] as const) {
      const failing = createDatabase({ DATABASE_URL: candidate.toString() });
      const error = await failing.probe().catch((caught: unknown) => caught);
      await failing.close();

      const logged = JSON.stringify(describeFailure(error));
      expect(isDependencyOutage(error)).toBe(true);
      expect(logged).not.toContain('canary-user');
      expect(logged).not.toContain('canary-pw');
      expect(logged).not.toContain('canary-db');
      expect(logged).toContain(`"code":"${code}"`);
    }
  });

  it('keeps a constraint violation and a syntax error as failures of the statement', async () => {
    await probe.insert(database.db, 'unique-once');

    const duplicate = await probe
      .insert(database.db, 'unique-once')
      .catch((caught: unknown) => caught);
    const syntax = await database.db
      .execute(sql`selct 1`)
      .catch((caught: unknown) => caught);

    expect(isDependencyOutage(duplicate)).toBe(false);
    expect(isDependencyOutage(syntax)).toBe(false);
  });

  it('reproduces a server out of connections: ER_CON_COUNT_ERROR is an outage', async () => {
    const held: Awaited<ReturnType<typeof createConnection>>[] = [];
    let error: unknown;
    try {
      for (let index = 0; index < 400 && error === undefined; index += 1) {
        try {
          held.push(await createConnection({ uri: target.url }));
        } catch (caught) {
          error = caught;
        }
      }
    } finally {
      await Promise.all(held.map((connection) => connection.end()));
    }

    expect((error as { code?: string }).code).toBe('ER_CON_COUNT_ERROR');
    expect(isDependencyOutage(error)).toBe(true);
  }, 60_000);

  describe('TLS through the ssl key of the URL', () => {
    /**
     * Reads the cipher of the session the URL connects with.
     *
     * @param url - The database URL.
     * @returns The cipher name, empty when the connection is in plain text.
     */
    async function cipherOf(url: string): Promise<string> {
      const secured = createDatabase({ DATABASE_URL: url });
      try {
        const [rows] = (await secured.db.execute(
          sql`show session status like 'Ssl_cipher'`,
        )) as unknown as [{ Value: string }[]];
        return rows[0]?.Value ?? '';
      } finally {
        await secured.close();
      }
    }

    it('connects over TLS when the key lists the options, and verifies the certificate by default', async () => {
      expect(
        await cipherOf(
          withQuery(target.url, 'ssl', '{"rejectUnauthorized":false}'),
        ),
      ).not.toBe('');

      const verified = createDatabase({
        DATABASE_URL: withQuery(target.url, 'ssl', '{}'),
      });
      const error = await verified.probe().catch((caught: unknown) => caught);
      await verified.close();
      expect((error as { code?: string }).code).toBe('HANDSHAKE_SSL_ERROR');
      expect(isDependencyOutage(error)).toBe(true);
    });

    it('db:migrate and db:status print fixed text and the code for a failed handshake, and no certificate text', async () => {
      process.env.DATABASE_URL = withQuery(target.url, 'ssl', '{}');
      try {
        for (const run of [runMigrate, runStatus]) {
          const error = await run(openStore, {
            out: { write: () => true },
          }).then(
            () => undefined,
            (caught: unknown) => caught,
          );

          const text = describeMigrateFailure(error);
          expect(text).toMatch(/^Cannot reach or open the database/);
          expect(text).toContain('HANDSHAKE_SSL_ERROR');
          expect(text).not.toMatch(/self-signed|certificate/i);
        }
      } finally {
        delete process.env.DATABASE_URL;
      }
    });
  });

  describe('a probe against a server that stops answering', () => {
    /**
     * Starts a proxy to the real server that can go silent.
     *
     * @returns The URL through it, how to make it silent, and the sockets it saw close.
     */
    async function silentableProxy(): Promise<{
      url: string;
      silence: () => void;
      closedUpstream: () => number;
      stop: () => Promise<void>;
    }> {
      const real = new URL(target.url);
      const sockets = new Set<Socket>();
      let silent = false;
      let closed = 0;
      const proxy = createServer((client) => {
        const upstream = new Socket();
        sockets.add(client);
        sockets.add(upstream);
        client.on('error', () => undefined);
        upstream.on('error', () => undefined);
        upstream.connect(Number(real.port), real.hostname);
        client.on('data', (data) => {
          if (!silent) upstream.write(data);
        });
        upstream.on('data', (data) => {
          if (!silent) client.write(data);
        });
        client.on('close', () => {
          closed += 1;
          upstream.destroy();
        });
      });
      await new Promise<void>((resolve) =>
        proxy.listen(0, '127.0.0.1', resolve),
      );
      const via = new URL(target.url);
      via.hostname = '127.0.0.1';
      via.port = String((proxy.address() as AddressInfo).port);
      return {
        url: via.toString(),
        silence: () => {
          silent = true;
        },
        closedUpstream: () => closed,
        stop: async () => {
          sockets.forEach((socket) => socket.destroy());
          await new Promise<void>((resolve) => proxy.close(() => resolve()));
        },
      };
    }

    it('reproduces a server that went silent: the probe gives up as an outage and drops its connection', async () => {
      const proxy = await silentableProxy();
      const behind = createDatabase({ DATABASE_URL: proxy.url });
      await behind.probe();
      proxy.silence();

      const error = await behind.probe().catch((caught: unknown) => caught);

      expect(isDependencyOutage(error)).toBe(true);
      expect((error as { code?: string }).code).toBe(
        'PROTOCOL_SEQUENCE_TIMEOUT',
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(proxy.closedUpstream()).toBeGreaterThanOrEqual(1);
      await behind.close();
      await proxy.stop();
    }, 15_000);
  });
});
