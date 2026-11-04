import type { FastifyBaseLogger } from 'fastify';
import { pino, type LoggerOptions } from 'pino';

import { accessLogSerializers } from '../http/access-log.js';

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
 * @returns The pino options.
 */
export function loggerOptions(level: string): LoggerOptions {
  return { level, redact: REDACT, serializers: accessLogSerializers };
}

/**
 * Builds the logger Fastify runs on.
 *
 * @param level - How much is logged.
 * @param stream - Where records go; stdout when omitted. Tests pass their own.
 * @returns A pino logger, typed as Fastify's base logger so the instance type stays plain.
 */
export function createLogger(
  level: string,
  stream?: NodeJS.WritableStream,
): FastifyBaseLogger {
  const options = loggerOptions(level);
  return stream ? pino(options, stream) : pino(options);
}
