import type { Params } from 'nestjs-pino';

import { accessLogOptions } from '../http/access-log.js';

/**
 * Fields never written anywhere.
 *
 * `remove` rather than a placeholder: a redacted marker still says the field
 * was there, and for a bearer token even the shape is more than a log needs.
 */
const REDACT = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'res.headers["set-cookie"]',
    '*.password',
    '*.passwordHash',
    '*.idToken',
    '*.refreshToken',
    '*.accessToken',
    '*.token',
    '*.secret',
  ],
  remove: true,
};

/**
 * Builds the one logger configuration of the process.
 *
 * Records go to stdout: under a container runtime that is the log.
 *
 * @param level - How much is logged.
 * @returns The configuration for `LoggerModule.forRoot`.
 */
export function loggerOptions(level: string): Params {
  return { pinoHttp: { level, redact: REDACT, ...accessLogOptions() } };
}
