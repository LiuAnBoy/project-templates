import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';

import { sql } from 'drizzle-orm';
import { createPool } from 'mysql2/promise';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { isDependencyOutage } from '../../common/errors/dependency-failure.js';
import { describeFailure } from '../../common/errors/failure.js';
import { createDatabase, databaseEnv } from '../database.js';

const CLOSED_PORT_URL = 'mysql://app:secret-pw@127.0.0.1:1/app';

describe('mysql outage, with no service running', () => {
  it('fails a query on a closed port with an error the classifier accepts', async () => {
    const database = createDatabase({ DATABASE_URL: CLOSED_PORT_URL });

    const error = await database.db
      .execute(sql`select 1`)
      .then(() => undefined)
      .catch((caught: unknown) => caught);
    await database.close();

    expect(error).toBeDefined();
    expect(isDependencyOutage(error)).toBe(true);
  });

  it('fails the probe on a closed port', async () => {
    const database = createDatabase({ DATABASE_URL: CLOSED_PORT_URL });

    const error = await database.probe().catch((caught: unknown) => caught);
    await database.close();

    expect(isDependencyOutage(error)).toBe(true);
  });

  it('describes a failed query without its bound values', async () => {
    const database = createDatabase({ DATABASE_URL: CLOSED_PORT_URL });

    const error = await database.db
      .execute(sql`select ${'SECRET-TOKEN-123'}`)
      .catch((caught: unknown) => caught);
    await database.close();

    const logged = JSON.stringify(describeFailure(error));
    expect(logged).toContain('Failed query');
    expect(logged).toContain('ECONNREFUSED');
    expect(logged).not.toContain('SECRET-TOKEN-123');
  });

  it('keeps no tail of a bound value that looks like a stack frame', async () => {
    const database = createDatabase({ DATABASE_URL: CLOSED_PORT_URL });
    const forged = 'x\n    at forged (SECRET-TAIL.js:1:1)\nSECRET-AFTER';

    const error = await database.db
      .execute(sql`select ${forged}`)
      .catch((caught: unknown) => caught);
    await database.close();

    const logged = JSON.stringify(describeFailure(error));
    expect(logged).toContain('Failed query');
    expect(logged).not.toContain('SECRET');
  });
});

describe('mysql connection failures described for the log, with no service running', () => {
  /**
   * Describes the failure of a probe against a URL.
   *
   * @param url - The database URL to fail against.
   * @returns The failure as the log line would hold it.
   */
  async function describeProbeAgainst(url: string): Promise<string> {
    const database = createDatabase({ DATABASE_URL: url });
    const error = await database.probe().catch((caught: unknown) => caught);
    await database.close();
    return JSON.stringify(describeFailure(error));
  }

  it('reproduces a refused connection: the log names no host, port, user or database, and keeps the class and the code', async () => {
    const logged = await describeProbeAgainst(
      'mysql://canary-user:canary-pw@127.0.0.1:1/canary-db',
    );

    for (const canary of [
      '127.0.0.1',
      'canary-user',
      'canary-pw',
      'canary-db',
    ]) {
      expect(logged).not.toContain(canary);
    }
    expect(logged).toContain('ECONNREFUSED');
    expect(logged).toContain('"name":"Error"');
  });

  it('reproduces a host that does not resolve: the log names no host and keeps ENOTFOUND', async () => {
    const logged = await describeProbeAgainst(
      'mysql://canary-user:canary-pw@canary-host.invalid:3306/canary-db',
    );

    expect(logged).not.toContain('canary-host');
    expect(logged).toMatch(/ENOTFOUND|EAI_AGAIN/);
  });
});

describe('mysql refusals of a login, by code', () => {
  it('answers each as an outage and logs only its code', () => {
    for (const code of [
      'ER_HOST_NOT_PRIVILEGED',
      'ER_HOST_IS_BLOCKED',
      'ER_ACCOUNT_HAS_BEEN_LOCKED',
      'ER_USER_LIMIT_REACHED',
      'ER_TOO_MANY_USER_CONNECTIONS',
      'ER_MUST_CHANGE_PASSWORD_LOGIN',
      'ER_SERVER_OFFLINE_MODE',
    ]) {
      const error = Object.assign(
        new Error("Refused 'canary-user'@'canary-host'"),
        { code, sqlState: 'HY000' },
      );

      expect(isDependencyOutage(error)).toBe(true);
      const logged = JSON.stringify(describeFailure(error));
      expect(logged).toContain(code);
      expect(logged).not.toContain('canary');
    }
  });

  it('logs only the code of an ER_* error no list names, with no statement above it', () => {
    const error = Object.assign(
      new Error("Refused 'canary-user'@'canary-host'"),
      { code: 'ER_SOME_FUTURE_REFUSAL' },
    );

    expect(isDependencyOutage(error)).toBe(false);
    const logged = JSON.stringify(describeFailure(error));
    expect(logged).toContain('ER_SOME_FUTURE_REFUSAL');
    expect(logged).not.toContain('canary');
  });
});

describe('mysql against a server that misbehaves', () => {
  let server: Server | undefined;
  const sockets = new Set<Socket>();

  afterEach(async () => {
    sockets.forEach((socket) => socket.destroy());
    sockets.clear();
    await new Promise<void>((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
    server = undefined;
  });

  /**
   * Starts a TCP server standing in for a MySQL that misbehaves.
   *
   * @param onConnection - What the server does with each connection.
   * @returns The URL of the server.
   */
  async function fakeServer(
    onConnection: (socket: Socket) => void,
  ): Promise<string> {
    const listening = createServer((socket) => {
      sockets.add(socket);
      socket.on('error', () => undefined);
      onConnection(socket);
    });
    server = listening;
    await new Promise<void>((resolve) =>
      listening.listen(0, '127.0.0.1', resolve),
    );
    const { port } = listening.address() as AddressInfo;
    return `mysql://app:secret-pw@127.0.0.1:${port}/app`;
  }

  it('classifies a connection the server drops as an outage', async () => {
    const url = await fakeServer((socket) => socket.destroy());
    const database = createDatabase({ DATABASE_URL: url });

    const error = await database.probe().catch((caught: unknown) => caught);
    await database.close();

    expect((error as { code?: string }).code).toBe('PROTOCOL_CONNECTION_LOST');
    expect(isDependencyOutage(error)).toBe(true);
  });

  it('classifies a server that never answers as an outage once the connect timeout passes', async () => {
    const url = await fakeServer(() => undefined);
    const database = createDatabase(
      { DATABASE_URL: url },
      { connectTimeoutMs: 200 },
    );

    const error = await database.probe().catch((caught: unknown) => caught);
    await database.close();

    expect(error).toBeInstanceOf(Error);
    expect(isDependencyOutage(error)).toBe(true);
  });

  it('reproduces a pool held by a connection that never comes up: a further call gives up at its acquire bound, as an outage', async () => {
    const url = await fakeServer(() => undefined);
    const database = createDatabase(
      { DATABASE_URL: url },
      { connectionLimit: 1, connectTimeoutMs: 5000, acquireTimeoutMs: 200 },
    );
    const holder = database.probe().catch((caught: unknown) => caught);
    const started = Date.now();

    const error = await database.db
      .execute(sql`select 1`)
      .catch((caught: unknown) => caught);

    expect(Date.now() - started).toBeLessThan(2000);
    expect(isDependencyOutage(error)).toBe(true);
    expect(JSON.stringify(describeFailure(error))).toContain(
      'no connection became free in time',
    );
    sockets.forEach((socket) => socket.destroy());
    await holder;
    await database.close();
  });

  it('reproduces the two refusals of a pool configured not to wait, which the factory never configures: both are outages', async () => {
    const url = await fakeServer(() => undefined);

    for (const [pool, message] of [
      [
        createPool({ uri: url, connectionLimit: 1, queueLimit: 1 }),
        'Queue limit reached.',
      ],
      [
        createPool({ uri: url, connectionLimit: 1, waitForConnections: false }),
        'No connections available.',
      ],
    ] as const) {
      void pool.query('select 1').catch(() => undefined);
      if (message === 'Queue limit reached.') {
        void pool.query('select 2').catch(() => undefined);
      }

      const error = await pool
        .query('select 3')
        .catch((caught: unknown) => caught);

      expect((error as Error).message).toBe(message);
      expect(isDependencyOutage(error)).toBe(true);
      sockets.forEach((socket) => socket.destroy());
      void pool.end().catch(() => undefined);
    }
  });

  it('refuses a call on a closed pool as an outage', async () => {
    const database = createDatabase({ DATABASE_URL: CLOSED_PORT_URL });
    await database.close();

    const error = await database.db
      .execute(sql`select 1`)
      .catch((caught: unknown) => caught);

    expect(isDependencyOutage(error)).toBe(true);
  });
});

describe('the settings of mysql', () => {
  const settings = z.object(databaseEnv);

  it('refuses a URL the driver cannot read, naming the setting and no value', () => {
    for (const value of [
      'mysql://:canary-pw@canary-host:canary-port/db',
      'mysql://canary@[canary-host]:3306/db',
      'mysql://u:canary-pw@h:3306/db?ssl=canary-not-json',
      'canary',
    ]) {
      const result = settings.safeParse({ DATABASE_URL: value });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['DATABASE_URL']);
      expect(JSON.stringify(result.error?.issues)).not.toContain('canary');
    }
  });

  it('refuses sslmode, which mysql2 ignores and would leave the connection in plain text', () => {
    const result = settings.safeParse({
      DATABASE_URL: 'mysql://u:canary-pw@h:3306/db?sslmode=require',
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain('canary');
  });

  it('accepts a URL with an unusual but valid shape', () => {
    for (const value of [
      'mysql://u:p%40ss@host:3307/db?charset=utf8mb4',
      'mysql://u:p@host/db?ssl=%7B%22rejectUnauthorized%22%3Atrue%7D',
    ]) {
      expect(settings.safeParse({ DATABASE_URL: value }).success).toBe(true);
    }
  });
});
