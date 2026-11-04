import type {
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';

/** What the limiter counts and where it keeps the counts. */
export type RateLimitOptions = {
  /** Requests allowed per client in one window. */
  max: number;
  /** The window, in seconds. */
  windowSeconds: number;
  /**
   * Where the counts live: `ThrottlerStorage` of `@nestjs/throttler` is the
   * port. Omitted, the module keeps them in one process's memory, so a second
   * instance needs a shared storage passed here.
   */
  storage?: ThrottlerStorage;
};

/**
 * Builds the options of `ThrottlerModule`, reading no configuration itself.
 *
 * The client is `request.ip`, which Fastify takes from the socket unless the
 * adapter was created with `trustProxy`; there is no second place that decides
 * the address. The key is the client alone, so every route shares one count
 * (the package's default would give each handler its own). A limit throws a
 * `ThrottlerException`, which `AllExceptionsFilter` answers from the failure
 * table; the package's `Retry-After` header stays. To exempt a route or a
 * controller, decorate it with `@SkipThrottle()`.
 *
 * @param options - The limit and, optionally, the storage.
 * @returns Options for `ThrottlerModule.forRootAsync`.
 */
export function createThrottlerOptions(
  options: RateLimitOptions,
): ThrottlerModuleOptions {
  return {
    throttlers: [{ ttl: options.windowSeconds * 1000, limit: options.max }],
    generateKey: (_context, tracker, throttlerName) =>
      `${throttlerName}:${tracker}`,
    ...(options.storage ? { storage: options.storage } : {}),
  };
}
