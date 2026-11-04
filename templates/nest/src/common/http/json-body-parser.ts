import type { FastifyInstance } from 'fastify';

import { AppError } from '../errors/app-error.js';

/**
 * Parses JSON bodies with Fastify's own safe parser, plus two deliberate rules.
 *
 * Nest's default body parser is turned off (`bodyParser: false`, see
 * `applicationOptions`) because Fastify allows one parser per content type.
 *
 * - An empty body with a JSON content type parses to `{}`. Fastify refuses it
 *   by default, which breaks every mutation a client sends with no body.
 * - A malformed body is an `invalidRequest` failure from the table, not the
 *   framework's English prose and status.
 *
 * Prototype-poisoning protection stays on: the default parser does the parsing.
 * The size limit stays Fastify's `bodyLimit`, because it must be enforced while
 * the body is being read; its refusal is translated in `AllExceptionsFilter`.
 *
 * @param instance - The Fastify instance behind the Nest application.
 */
export function registerJsonBodyParser(instance: FastifyInstance): void {
  const parse = instance.getDefaultJsonParser('error', 'error');
  instance.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (request, body: string, done) => {
      if (body === '') {
        done(null, {});
        return;
      }
      parse(request, body, (error, parsed) => {
        done(error ? new AppError('invalidRequest') : null, parsed);
      });
    },
  );
}
