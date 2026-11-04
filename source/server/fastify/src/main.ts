import { ZodError } from 'zod';

import { runStartupChecks } from './common/dependency-checks.js';
import { loadConfig, type Config } from './config.js';
import { createStaticGreeter } from './hello/greeter.js';
import { createHelloModule } from './hello/routes.js';
import { createInfra } from './infra/infra.js';
import { buildServer } from './server.js';

/**
 * Boots the HTTP process: load config, build the server, listen, and close on
 * shutdown signals. Before it listens, every dependency check of the infra seam
 * runs under `bounded()`; a failed start, a failed check included, exits
 * non-zero after closing what it opened, and a failed check is named, never
 * its value.
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
  const infra = createInfra(config);
  const app = await buildServer({
    logLevel: config.LOG_LEVEL,
    trustProxy: config.TRUST_PROXY,
    rateLimit: {
      max: config.RATE_LIMIT_MAX,
      windowSeconds: config.RATE_LIMIT_WINDOW_SECONDS,
      store: infra.rateLimitStore,
    },
    checks: infra.checks,
    modules: [createHelloModule({ greeter: createStaticGreeter() })],
  });

  const shutdown = (signal: string): void => {
    app.log.info({ signal }, 'shutting down');
    app
      .close()
      .then(() => infra.close())
      .then(
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
    await runStartupChecks(infra.checks);
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch (error) {
    app.log.error({ err: error }, 'failed to start');
    await app.close();
    await infra.close();
    process.exit(1);
  }
}

void main();
