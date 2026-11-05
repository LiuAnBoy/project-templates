import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';

import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { isDependencyOutage } from '../../common/errors/dependency-failure.js';
import { describeFailure } from '../../common/errors/failure.js';
import { openStore } from '../../../scripts/db/adapter.mjs';
import { createDatabase, databaseEnv } from '../database.js';

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

/**
 * Builds one message of the PostgreSQL protocol.
 *
 * @param type - The message type.
 * @param body - What follows the length.
 * @returns The message.
 */
function message(type: string, body: Buffer = Buffer.alloc(0)): Buffer {
  const length = Buffer.alloc(4);
  length.writeInt32BE(body.length + 4);
  return Buffer.concat([Buffer.from(type), length, body]);
}

/** A login that needs nothing, and the server ready for a statement. */
const LOGGED_IN = Buffer.concat([
  message('R', Buffer.alloc(4)),
  message('Z', Buffer.from('I')),
]);

/**
 * Builds the reply of a server that ends the connection.
 *
 * @param code - The SQLSTATE.
 * @param text - The server's message.
 * @returns The message.
 */
function fatal(code: string, text: string): Buffer {
  return message(
    'E',
    Buffer.from(`SFATAL\0VFATAL\0C${code}\0M${text}\0\0`, 'utf8'),
  );
}

/** The first bytes a client sends to ask for TLS. */
const SSL_REQUEST_CODE = 80877103;

describe('postgres through the real client, against a server that misbehaves on the wire', () => {
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
   * Starts a server that answers a TLS request and hands every other message on.
   *
   * @param onMessage - What it does with a message of the protocol.
   * @param tlsReply - What it answers a TLS request with.
   * @param query - The query string of the URL.
   * @returns The URL of the server.
   */
  async function serve(
    onMessage: (socket: Socket, data: Buffer) => void,
    tlsReply = 'N',
    query = '',
  ): Promise<string> {
    const listening = createServer((socket) => {
      sockets.add(socket);
      socket.on('error', () => undefined);
      socket.on('data', (data) => {
        if (data.length === 8 && data.readInt32BE(4) === SSL_REQUEST_CODE) {
          socket.write(tlsReply);
          return;
        }
        onMessage(socket, data);
      });
    });
    server = listening;
    await new Promise<void>((resolve) =>
      listening.listen(0, '127.0.0.1', resolve),
    );
    const { port } = listening.address() as AddressInfo;
    return `postgresql://canary-user:canary-pw@127.0.0.1:${port}/canary-db${query}`;
  }

  /**
   * Serves a login, the `begin` of a transaction, and nothing after it.
   *
   * @param onStatement - What happens to the statement after `begin`.
   * @returns The URL of the server.
   */
  function serveTransaction(
    onStatement: (socket: Socket) => void,
  ): Promise<string> {
    return serve((socket, data) => {
      const text = data.toString('utf8');
      if (data[0] !== 'Q'.charCodeAt(0)) socket.write(LOGGED_IN);
      else if (text.includes('begin')) {
        socket.write(
          Buffer.concat([
            message('C', Buffer.from('BEGIN\0')),
            message('Z', Buffer.from('T')),
          ]),
        );
      } else onStatement(socket);
    });
  }

  it('reproduces a connection lost inside transactions.run: the run fails as an outage and the process stays up', async () => {
    const url = await serveTransaction((socket) => socket.destroy());
    const database = createDatabase({ DATABASE_URL: url });

    const error = await database.transactions
      .run((tx) => tx.execute(sql`select 1`))
      .catch((caught: unknown) => caught);
    await database.close();

    // With no listener on the borrowed client this ends the run with an uncaught
    // exception, which fails the whole test file.
    expect(error).toBeInstanceOf(Error);
    expect(isDependencyOutage(error)).toBe(true);
  });

  it('reproduces a wrong password and an unknown database: an outage, with the code and no name in the log', async () => {
    for (const [code, text] of [
      ['28P01', 'password authentication failed for user "canary-user"'],
      ['3D000', 'database "canary-db" does not exist'],
    ] as const) {
      const url = await serve((socket) => socket.write(fatal(code, text)));
      const database = createDatabase({ DATABASE_URL: url });

      const error = await database.db
        .execute(sql`select 1`)
        .catch((caught: unknown) => caught);
      await database.close();

      const logged = JSON.stringify(describeFailure(error));
      expect(isDependencyOutage(error)).toBe(true);
      expect(logged).toContain(code);
      expect(logged).not.toContain('canary');
      sockets.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
  });

  it('reproduces TLS refused and a broken handshake: an outage', async () => {
    for (const reply of ['N', 'S']) {
      const url = await serve(
        (socket) => socket.write('not a handshake'),
        reply,
        '?sslmode=verify-full',
      );
      const database = createDatabase({ DATABASE_URL: url });

      const error = await database.probe().catch((caught: unknown) => caught);
      await database.close();

      expect(error).toBeInstanceOf(Error);
      expect(isDependencyOutage(error)).toBe(true);
      sockets.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
  });

  it('reproduces a connection lost while db:migrate holds it: the migration fails with an outage and the process stays up', async () => {
    const empty = message('C', Buffer.from('SELECT 0\0'));
    const url = await serve((socket, data) => {
      const text = data.toString('utf8');
      if (data[0] !== 'Q'.charCodeAt(0)) socket.write(LOGGED_IN);
      else if (text.toLowerCase().includes('begin')) socket.destroy();
      else socket.write(Buffer.concat([empty, message('Z', Buffer.from('I'))]));
    });
    process.env.DATABASE_URL = url;
    try {
      const store = await openStore({ forMigrate: true });

      const error = await store
        .migrate('drizzle')
        .catch((caught: unknown) => caught);
      await store.close();

      expect(isDependencyOutage(error)).toBe(true);
    } finally {
      delete process.env.DATABASE_URL;
    }
  });

  it('keeps a failed statement a 500', async () => {
    const url = await serve((socket, data) => {
      if (data[0] !== 'Q'.charCodeAt(0)) {
        socket.write(LOGGED_IN);
        return;
      }
      socket.write(
        Buffer.concat([
          message(
            'E',
            Buffer.from('SERROR\0VERROR\0C42601\0Msyntax error\0\0', 'utf8'),
          ),
          message('Z', Buffer.from('I')),
        ]),
      );
    });
    const database = createDatabase({ DATABASE_URL: url });

    const error = await database.db
      .execute(sql`select 1`)
      .catch((caught: unknown) => caught);
    await database.close();

    expect(isDependencyOutage(error)).toBe(false);
  });

  it('reproduces a server that went silent: the probe gives up and frees its connection', async () => {
    const closed = new Promise<void>((resolve) => {
      void serve((socket, data) => {
        socket.once('close', () => resolve());
        if (data[0] !== 'Q'.charCodeAt(0)) socket.write(LOGGED_IN);
      }).then((url) => {
        const database = createDatabase({ DATABASE_URL: url });
        void database.probe().catch(() => undefined);
      });
    });

    await closed;
  }, 6000);

  it('closes within its bound while a connection is stuck on a silent server', async () => {
    const url = await serveTransaction(() => undefined);
    const database = createDatabase({ DATABASE_URL: url });
    const stuck = database.transactions
      .run((tx) => tx.execute(sql`select 1`))
      .catch((caught: unknown) => caught);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const started = Date.now();

    await database.close();

    expect(Date.now() - started).toBeLessThan(1500);
    sockets.forEach((socket) => socket.destroy());
    await stuck;
  });
});

describe('the settings of postgres', () => {
  const settings = z.object(databaseEnv);

  it('refuses a URL the driver cannot read, naming the setting and no value', () => {
    for (const value of [
      'postgresql://:canary-pw@canary-host:canary-port/db',
      'postgresql://canary@[canary-host]:5432/db',
      'postgresql://u:canary-pw@h:5432/db?sslcert=/canary/missing',
      'canary',
    ]) {
      const result = settings.safeParse({ DATABASE_URL: value });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['DATABASE_URL']);
      expect(JSON.stringify(result.error?.issues)).not.toContain('canary');
    }
  });

  it('accepts a URL with an unusual but valid shape', () => {
    expect(
      settings.safeParse({
        DATABASE_URL: 'postgres://u:p%40ss@host:5433/db?sslmode=disable',
      }).success,
    ).toBe(true);
  });
});
