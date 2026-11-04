import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';

import { AppError } from '../errors/app-error.js';
import { isDependencyOutage } from '../errors/dependency-failure.js';
import { describeFailure } from '../errors/failure.js';
import { FAILURES, failureForStatus } from '../errors/failures.js';
import { failure } from './envelope.js';

/**
 * Reads the HTTP status a framework attached to an error.
 *
 * Fastify's own errors (an oversized body, an unsupported media type) carry a
 * 4xx `statusCode`.
 *
 * @param error - Whatever was thrown.
 * @returns The status, when it is a 4xx or 5xx.
 */
function frameworkStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' && status >= 400 && status <= 599
    ? status
    : undefined;
}

/**
 * Sends a failure envelope.
 *
 * @param reply - The reply.
 * @param status - The HTTP status.
 * @param message - The fixed message.
 * @returns The reply, for chaining.
 */
function send(
  reply: FastifyReply,
  status: number,
  message: string,
): FastifyReply {
  return reply.status(status).send(failure(message));
}

/**
 * Turns every thrown error into the failure envelope. The only place a failure
 * body is built, so a client never sees a framework's own text.
 *
 * The first match wins:
 *
 * 1. a request that failed zod validation: 400, the issues go to the debug log;
 * 2. an `AppError`: its own status and message;
 * 3. a response that failed its own schema: our bug, 500;
 * 4. an error a framework raised (4xx or 5xx `statusCode`): the table message
 *    for that status, and a 5xx is logged;
 * 5. a dependency outage (unreachable database, timeout): 503;
 * 6. anything else: logged with its whole cause chain, answered with the fixed 500.
 *
 * @param error - What was thrown.
 * @param request - The request that failed.
 * @param reply - The reply.
 * @returns The reply.
 */
function handleError(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (hasZodFastifySchemaValidationErrors(error)) {
    request.log.debug(
      { issues: error.validation },
      'request failed validation',
    );
    return send(
      reply,
      FAILURES.invalidRequest.status,
      FAILURES.invalidRequest.message,
    );
  }

  if (error instanceof AppError) {
    return send(reply, error.status, error.message);
  }

  if (isResponseSerializationError(error)) {
    request.log.error(
      { failure: describeFailure(error) },
      'response failed its schema',
    );
    return send(reply, FAILURES.internal.status, FAILURES.internal.message);
  }

  const status = frameworkStatus(error);
  if (status !== undefined) {
    const entry = failureForStatus(status);
    if (status >= 500)
      request.log.error({ failure: describeFailure(error) }, 'framework error');
    return send(reply, entry.status, entry.message);
  }

  if (isDependencyOutage(error)) {
    request.log.error(
      { failure: describeFailure(error) },
      'dependency unreachable',
    );
    return send(
      reply,
      FAILURES.unavailable.status,
      FAILURES.unavailable.message,
    );
  }

  request.log.error({ failure: describeFailure(error) }, 'unhandled error');
  return send(reply, FAILURES.internal.status, FAILURES.internal.message);
}

/**
 * Registers the error handler and the not-found handler on the instance.
 *
 * @param instance - The root Fastify instance, so every scope inherits them.
 * @param beforeNotFound - A `preHandler` to run before the not-found answer,
 *   which is where a request to an unknown path is counted by the rate limit.
 */
export function registerErrorHandling(
  instance: FastifyInstance,
  beforeNotFound?: preHandlerAsyncHookHandler,
): void {
  instance.setErrorHandler(handleError);
  instance.setNotFoundHandler(
    beforeNotFound ? { preHandler: beforeNotFound } : {},
    (_request, reply) =>
      send(reply, FAILURES.notFound.status, FAILURES.notFound.message),
  );
}
