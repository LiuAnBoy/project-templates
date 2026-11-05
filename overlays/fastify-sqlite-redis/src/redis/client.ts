import { Redis } from 'ioredis';
import { z } from 'zod';

import { bounded } from '../common/concurrency/bounded.js';
import { isDependencyOutage } from '../common/errors/dependency-failure.js';

/**
 * The settings of Redis, spread into the environment schema by
 * `src/infra/infra-env.ts`. Required: a missing or malformed value stops the
 * boot naming the variable, and the message never carries the value.
 */
export const redisEnv = {
  REDIS_URL: z
    .string()
    .regex(/^rediss?:\/\//, 'must be a redis:// or rediss:// URL')
    .refine(isUsableUrl, 'must be a valid redis:// or rediss:// URL'),
};

/**
 * Whether the driver can read a URL. Building a client that does not connect
 * parses the URL, and a parser's error quotes what it read, so it stays inside
 * this check.
 *
 * @param url - The raw setting.
 * @returns True when a client can be built from it.
 */
function isUsableUrl(url: string): boolean {
  try {
    new Redis(url, { lazyConnect: true });
    return true;
  } catch {
    return false;
  }
}

/** What `createRedisClient` reads of the validated environment. */
export type RedisConfig = { REDIS_URL: string };

/**
 * The service prefix of the keys this template writes itself (the rate limiter's
 * counters). Several services may share one Redis, so change it to the name of
 * the project, and use it for the keys of your own code too (`<service>:<entity>:<id>`).
 * Fastify's counters start with it (`app:rate-limit:...`); Nest's come from a package
 * that wraps each key in a hash tag, so they contain it without starting with it
 * (`{app:rate-limit:default:<client>:default}:hits`).
 */
export const REDIS_KEY_PREFIX = 'app';

/** What a store factory hands to the seam: the client, a probe and a close. */
export type RedisPort = {
  /** The name a dependency check and a log line give this store. */
  name: 'redis';
  /** The client; one per process, shared by everything that needs Redis. */
  client: Redis;
  /** One real round trip; rejects when Redis does not answer. */
  probe: () => Promise<void>;
  /** Ends the connection; safe to call twice. */
  close: () => Promise<void>;
};

/** Settings that tests and unusual deployments may change. */
export type RedisClientOptions = {
  /** How long a connection attempt may take, in milliseconds. */
  connectTimeoutMs?: number;
  /** Where the one-line connection messages go; defaults to `console.error`. */
  log?: (line: string) => void;
};

const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

/** How long `close` waits for a polite `QUIT` before cutting the connection. */
const CLOSE_WAIT_MS = 1000;

/** How long the same failure stays quiet before it is worth saying again. */
const LOG_WINDOW_MS = 10_000;

/**
 * How long a connection waits before trying again, given how many times it has
 * failed: 500 ms more each time, never more than 5 seconds.
 *
 * ioredis defaults to `times * 50` capped at 2 seconds, which during an outage
 * means a dozen attempts a second and a log full of the same line. The cap is
 * also how long recovery can lag after Redis is back, so it stays short.
 *
 * @param times - How many attempts have failed.
 * @returns Milliseconds to wait before the next one.
 */
export function retryDelay(times: number): number {
  return Math.min(times * 500, 5000);
}

/**
 * Names an error for a log line without printing anything it carries.
 *
 * The message of a connection error can hold a host, a path or part of the URL,
 * so only the code, or the class name, is printed. A reply of the server adds
 * its protocol word (`WRONGPASS`, `NOAUTH`), which is never user data.
 *
 * @param error - Whatever the client emitted.
 * @returns A short token such as `ECONNREFUSED` or `ReplyError WRONGPASS`.
 */
function label(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'Error';
  const { code, name, message } = error as Record<string, unknown>;
  if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,40}$/.test(code)) {
    return code;
  }
  const cls =
    typeof name === 'string' && /^[A-Za-z]{1,40}$/.test(name) ? name : 'Error';
  const word =
    cls === 'ReplyError' && typeof message === 'string'
      ? /^[A-Z]{3,20}/.exec(message)?.[0]
      : undefined;
  return word ? `${cls} ${word}` : cls;
}

/**
 * Says a connection is broken once rather than once per retry.
 *
 * An unreachable server makes the client emit an error on every attempt, and a
 * listener that prints each one fills the log with a single sentence. A failure
 * is printed the first time, then once per window with the count of the rest;
 * a connection that was up and dropped is printed once, and so is the reconnect.
 *
 * @param write - Where lines go.
 * @returns The events the client reports.
 */
function createConnectionLog(write: (line: string) => void): {
  failed: (error: unknown) => void;
  closed: () => void;
  ready: () => void;
} {
  const seen = new Map<string, { at: number; suppressed: number }>();
  let up = false;
  let down = false;
  return {
    closed() {
      if (!up) return;
      up = false;
      down = true;
      write('redis: connection lost, retrying');
    },
    failed(error) {
      down = true;
      const kind = isDependencyOutage(error) ? 'unreachable' : 'client error';
      const what = label(error);
      const key = `${kind}:${what}`;
      const now = Date.now();
      const previous = seen.get(key);
      if (previous && now - previous.at < LOG_WINDOW_MS) {
        previous.suppressed += 1;
        return;
      }
      seen.set(key, { at: now, suppressed: 0 });
      const rest =
        previous && previous.suppressed > 0
          ? `, ${previous.suppressed} further attempts not logged`
          : '';
      write(
        kind === 'unreachable'
          ? `redis: unreachable (${what}), retrying${rest}`
          : `redis: client error (${what})${rest}`,
      );
    },
    ready() {
      up = true;
      if (!down) return;
      down = false;
      seen.clear();
      write('redis: connection restored');
    },
  };
}

/**
 * Creates the Redis client, a probe and a close.
 *
 * The client connects at once and keeps reconnecting with a capped delay. Until
 * its first connection settles, a command waits for it, so code that runs
 * right after the client was created works; from then on there is no offline
 * queue, and while the client holds no connection every command fails with an
 * error `isDependencyOutage` accepts, instead of waiting in memory and running
 * late, minutes after the request that sent it was answered. It does not read
 * the environment and assumes nothing about where the server is. Its `error`
 * events are handled here, one line each at most, so a lost connection never
 * ends the process and never prints the URL. A connection made with
 * `client.duplicate()`, which a subscriber needs, gets the same listener: ioredis
 * prints the whole error of a client with none, host and port included. `close`
 * ends those connections too.
 *
 * @param config - The validated settings.
 * @param options - Timeouts and the log, for tests.
 * @returns The Redis port.
 */
export function createRedisClient(
  config: RedisConfig,
  options: RedisClientOptions = {},
): RedisPort {
  const connectionLog = createConnectionLog(
    options.log ?? ((line) => console.error(line)),
  );
  const client = new Redis(config.REDIS_URL, {
    retryStrategy: retryDelay,
    // A command that waited for a connection that keeps failing is rejected
    // after one more attempt, and never runs late.
    maxRetriesPerRequest: 1,
    autoResendUnfulfilledCommands: false,
    connectTimeout: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
  });
  const settled = (): void => {
    client.options.enableOfflineQueue = false;
  };
  client.once('ready', settled);
  client.once('close', settled);
  const duplicates = new Set<Redis>();
  const makeDuplicate = client.duplicate.bind(client);
  client.duplicate = (...args: Parameters<Redis['duplicate']>): Redis => {
    const duplicate = makeDuplicate(...args);
    duplicate.on('error', (error: unknown) => connectionLog.failed(error));
    duplicates.add(duplicate);
    return duplicate;
  };
  client.on('error', (error: unknown) => connectionLog.failed(error));
  client.on('close', () => connectionLog.closed());
  client.on('ready', () => connectionLog.ready());
  let closed = false;
  return {
    name: 'redis',
    client,
    probe: async () => {
      const reply = await client.ping();
      if (reply !== 'PONG') throw new Error('redis: unexpected reply to PING');
    },
    close: async () => {
      if (closed) return;
      closed = true;
      if (client.status === 'ready') {
        try {
          await bounded(client.quit(), CLOSE_WAIT_MS, 'redis');
        } catch {
          // The polite quit failed; the connection is cut below.
        }
      }
      client.disconnect();
      for (const duplicate of duplicates) duplicate.disconnect();
    },
  };
}
