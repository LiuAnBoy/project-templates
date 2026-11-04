import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';

import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { isDependencyOutage } from '../../common/errors/dependency-failure.js';
import { describeFailure } from '../../common/errors/failure.js';
import { createDatabase } from '../database.js';

const CLOSED_PORT_URL = 'postgresql://app:secret-pw@127.0.0.1:1/app';

describe('postgres outage, with no service running', () => {
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
      .execute(sql`select ${'SECRET-TOKEN-123'}::text`)
      .catch((caught: unknown) => caught);
    await database.close();

    const logged = JSON.stringify(describeFailure(error));
    expect(logged).toContain('Failed query');
    expect(logged).toContain('ECONNREFUSED');
    expect(logged).not.toContain('SECRET-TOKEN-123');
  });
});

describe('postgres connection failures described for the log, with no service running', () => {
  /**
   * Finds a port nothing listens on.
   *
   * @returns A port that was just free.
   */
  async function closedPort(): Promise<number> {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const { port } = probe.address() as AddressInfo;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    return port;
  }

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
    const port = await closedPort();

    const logged = await describeProbeAgainst(
      `postgresql://canary-user:canary-pw@127.0.0.1:${port}/canary-db`,
    );

    for (const canary of [
      '127.0.0.1',
      String(port),
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
      'postgresql://canary-user:canary-pw@canary-host.invalid:5432/canary-db',
    );

    expect(logged).not.toContain('canary-host');
    expect(logged).toMatch(/ENOTFOUND|EAI_AGAIN/);
  });
});

describe('postgres failures described for the log, with no service running', () => {
  it('keeps no tail of a bound value that looks like a stack frame', async () => {
    const database = createDatabase({ DATABASE_URL: CLOSED_PORT_URL });
    const forged = 'x\n    at forged (SECRET-TAIL.js:1:1)\nSECRET-AFTER';

    const error = await database.db
      .execute(sql`select ${forged}::text`)
      .catch((caught: unknown) => caught);
    await database.close();

    const logged = JSON.stringify(describeFailure(error));
    expect(logged).toContain('Failed query');
    expect(logged).not.toContain('SECRET');
  });
});

describe('postgres connection errors that carry no code', () => {
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
   * Starts a TCP server standing in for a PostgreSQL that misbehaves.
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
    return `postgresql://app:secret-pw@127.0.0.1:${port}/app`;
  }

  it('classifies a connection the server drops as an outage', async () => {
    const url = await fakeServer((socket) =>
      socket.once('data', () => socket.end()),
    );
    const database = createDatabase({ DATABASE_URL: url });

    const error = await database.probe().catch((caught: unknown) => caught);
    await database.close();

    expect((error as Error).message).toBe('Connection terminated unexpectedly');
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
});
