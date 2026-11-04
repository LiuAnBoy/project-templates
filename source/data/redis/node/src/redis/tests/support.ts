import { randomBytes } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';

import type { Redis } from 'ioredis';

import { requireLocalUrl } from '../../common/tests/local-target.js';

/** A Redis for a store test to run against, and the key prefix that test owns. */
export type TestTarget = {
  /** The value for `REDIS_URL`. */
  url: string;
  /** A random service prefix; every key a test writes starts with it. */
  prefix: string;
};

/**
 * The Redis the store tests run against: `TEST_REDIS_URL`, which must name a
 * local host. A test writes only under a random prefix of its own and removes
 * what it wrote by `deleteByPrefix`; it never flushes.
 *
 * @returns The target.
 * @throws Error when `TEST_REDIS_URL` is missing or not local.
 */
export function testTarget(): TestTarget {
  return {
    url: requireLocalUrl('TEST_REDIS_URL'),
    prefix: `it${randomBytes(6).toString('hex')}`,
  };
}

/**
 * Lists the keys that contain a prefix, with `SCAN` in batches.
 *
 * @param client - A connected client.
 * @param prefix - The test's prefix.
 * @returns The keys found.
 */
export async function keysWithPrefix(
  client: Redis,
  prefix: string,
): Promise<string[]> {
  const found: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await client.scan(
      cursor,
      'MATCH',
      `*${prefix}*`,
      'COUNT',
      200,
    );
    cursor = next;
    found.push(...batch);
  } while (cursor !== '0');
  return found;
}

/**
 * Deletes the keys of one test by exact name, never by a flush.
 *
 * @param client - A connected client.
 * @param prefix - The test's prefix.
 * @returns Resolves once the keys are gone.
 */
export async function deleteByPrefix(
  client: Redis,
  prefix: string,
): Promise<void> {
  const keys = await keysWithPrefix(client, prefix);
  if (keys.length > 0) await client.del(...keys);
}

/** A stand-in for a Redis that a test scripts, and how to stop it. */
export type FakeRedis = {
  /** A URL, with a password, that names the stand-in. */
  url: string;
  /** Closes the listener and every connection. */
  stop: () => Promise<void>;
};

/**
 * Starts a server that speaks just enough of the Redis protocol for a test to
 * script a misbehaving Redis. No service is needed, so the tests that use it
 * run with the unit tests.
 *
 * @param answer - Called with the name of each command a client sends
 *   (`INFO`, `EVAL`, ...), in order; returns the raw reply to write, or
 *   undefined to leave the command unanswered.
 * @returns The stand-in.
 */
export async function fakeRedis(
  answer: (command: string) => string | undefined,
): Promise<FakeRedis> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('data', (chunk: Buffer) => {
      // A command is an array of bulk strings; its first element is the name.
      for (const found of chunk
        .toString('latin1')
        .matchAll(/\*\d+\r\n\$\d+\r\n([^\r\n]+)\r\n/g)) {
        const reply = answer((found[1] ?? '').toUpperCase());
        if (reply !== undefined) socket.write(reply);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `redis://:secret-pw@127.0.0.1:${port}`,
    stop: async () => {
      sockets.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * Starts a Redis that completes the client's handshake and then never answers a
 * command: what a half-open connection or a frozen Redis looks like.
 *
 * @returns The stand-in.
 */
export function silentRedis(): Promise<FakeRedis> {
  let silent = false;
  return fakeRedis((command) => {
    if (silent) return undefined;
    if (command !== 'INFO') return '+OK\r\n';
    silent = true;
    const info = '# Server\r\nredis_version:8.0.0\r\nloading:0\r\n';
    return `$${info.length}\r\n${info}\r\n`;
  });
}
