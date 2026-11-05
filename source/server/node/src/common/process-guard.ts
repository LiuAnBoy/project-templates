/**
 * What the process does with a failure nothing caught.
 *
 * Node ends the process on a promise rejection nobody handled and on an `error`
 * event of an emitter nobody listens to, and prints the error as it is, message
 * included. A dependency lost after startup must answer 503 and leave the process
 * up, wherever the code that met it was running, so a stray outage (a timer started
 * by a service, a client a project created itself) is logged and the process goes on.
 * Anything else is a bug the process cannot reason about: it is logged the same way,
 * without the values a driver's message carries, and the process ends, as Node's
 * default would.
 */
import { isDependencyOutage } from './errors/dependency-failure.js';
import { describeFailure } from './errors/failure.js';

/** What `handleStrayFailure` writes to and how it ends the process; tests replace both. */
export type StrayFailureOptions = {
  write?: (line: string) => void;
  exit?: (code: number) => void;
};

/**
 * Handles one failure nothing caught.
 *
 * @param kind - `unhandled rejection` or `uncaught exception`.
 * @param failure - What was thrown or rejected.
 * @param options - Where the line goes and how the process ends.
 */
export function handleStrayFailure(
  kind: string,
  failure: unknown,
  options: StrayFailureOptions = {},
): void {
  const write = options.write ?? ((line) => console.error(line));
  const exit = options.exit ?? ((code) => process.exit(code));
  const outage = isDependencyOutage(failure);
  write(
    `${kind}${outage ? ' (dependency unreachable, staying up)' : ''}: ${JSON.stringify(describeFailure(failure))}`,
  );
  if (!outage) exit(1);
}

/** How long a graceful shutdown may take before the process ends anyway, in milliseconds. */
const SHUTDOWN_DEADLINE_MS = 10_000;

/**
 * Registers the handlers on the process. `main.ts` calls this first.
 *
 * A shutdown waits for the requests in flight, and a request waiting on a server
 * that went silent never finishes, so a signal also starts a deadline. The timer
 * does not keep the process alive, so a shutdown that finishes first ends it as usual.
 */
export function installProcessGuards(): void {
  process.on('unhandledRejection', (reason) => {
    handleStrayFailure('unhandled rejection', reason);
  });
  process.on('uncaughtException', (error) => {
    handleStrayFailure('uncaught exception', error);
  });
  const startDeadline = (): void => {
    setTimeout(() => {
      console.error('shutdown did not finish in time, exiting');
      process.exit(1);
    }, SHUTDOWN_DEADLINE_MS).unref();
  };
  process.once('SIGINT', startDeadline);
  process.once('SIGTERM', startDeadline);
}
