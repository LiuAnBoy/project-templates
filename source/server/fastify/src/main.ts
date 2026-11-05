import { runStartupChecks } from './common/dependency-checks.js';
import { describeFailure } from './common/errors/failure.js';
import { describeStartupFailure } from './common/errors/startup-failure.js';
import { installProcessGuards } from './common/process-guard.js';
import { loadConfig, type Config } from './config.js';
import { createStaticGreeter } from './hello/greeter.js';
import { createHelloModule } from './hello/routes.js';
import { createInfra } from './infra/infra.js';
import type { Infra } from './infra/types.js';
import { buildServer } from './server.js';

/**
 * Boots the HTTP process: load config, build the server, listen, and close on
 * shutdown signals. Before it listens, every dependency check of the infra seam
 * runs under `bounded()`; a failed start, a failed check included, exits
 * non-zero after closing what it opened, and prints `describeStartupFailure`,
 * which names a setting or a check and never a value.
 *
 * @returns Resolves once the server is listening.
 */
async function main(): Promise<void> {
  installProcessGuards();
  let config: Config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(describeStartupFailure(error));
    process.exit(1);
  }

  // The one wiring place: pick the implementations and mount the modules.
  // A new domain is one more line in `modules`.
  let infra: Infra | undefined;
  let app: Awaited<ReturnType<typeof buildServer>> | undefined;
  try {
    infra = createInfra(config);
    app = await buildServer({
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

    const server = app;
    const resources = infra;
    const shutdown = (signal: string): void => {
      server.log.info({ signal }, 'shutting down');
      server
        .close()
        .then(() => resources.close())
        .then(
          () => process.exit(0),
          (error: unknown) => {
            server.log.error(
              { failure: describeFailure(error) },
              'shutdown failed',
            );
            process.exit(1);
          },
        );
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));

    await runStartupChecks(infra.checks);
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch (error) {
    console.error(describeStartupFailure(error));
    try {
      await app?.close();
      await infra?.close();
    } catch (closeError) {
      console.error(describeStartupFailure(closeError));
    }
    process.exit(1);
  }
}

void main();
