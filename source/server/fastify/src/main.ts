import { ZodError } from 'zod';

import { loadConfig, type Config } from './config.js';
import { createStaticGreeter } from './hello/greeter.js';
import { createHelloModule } from './hello/routes.js';
import { buildServer } from './server.js';

/**
 * Boots the HTTP process: load config, build the server, listen, and close on
 * shutdown signals. A failed start exits non-zero after closing what it opened.
 *
 * @returns Resolves once the server is listening.
 */
async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig();
  } catch (error) {
    const detail =
      error instanceof ZodError
        ? error.issues.map((i) => i.path.join('.')).join(', ')
        : String(error);
    console.error(`invalid configuration: ${detail}`);
    process.exit(1);
  }

  // The one wiring place: pick the implementations and mount the modules.
  // A new domain is one more line in `modules`.
  const app = await buildServer({
    logLevel: config.LOG_LEVEL,
    trustProxy: config.TRUST_PROXY,
    rateLimit: {
      max: config.RATE_LIMIT_MAX,
      windowSeconds: config.RATE_LIMIT_WINDOW_SECONDS,
    },
    modules: [createHelloModule({ greeter: createStaticGreeter() })],
  });

  const shutdown = (signal: string): void => {
    app.log.info({ signal }, 'shutting down');
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        app.log.error({ err: error }, 'shutdown failed');
        process.exit(1);
      },
    );
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch (error) {
    app.log.error({ err: error }, 'failed to start');
    await app.close();
    process.exit(1);
  }
}

void main();
