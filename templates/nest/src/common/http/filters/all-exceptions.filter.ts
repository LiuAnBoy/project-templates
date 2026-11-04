import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PinoLogger } from 'nestjs-pino';
import { ZodValidationException } from 'nestjs-zod';

import { AppError } from '../../errors/app-error.js';
import { isDependencyOutage } from '../../errors/dependency-failure.js';
import { describeFailure } from '../../errors/failure.js';
import { FAILURES, failureForStatus } from '../../errors/failures.js';
import { routePattern } from '../access-log.js';

/** The failure body: a message and nothing else. */
type ErrorBody = { success: false; payload: { message: string } };

/** What the request can tell us about where a failure happened. */
type Origin = { route?: string; requestId?: string };

/**
 * Reads the HTTP status a framework attached to an error that is not an
 * `HttpException`, such as Fastify's own refusal of an oversized body.
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
 * The single place that turns a thrown error into a response body.
 *
 * A failure carries only a message; the status classifies it. The internal code
 * and any validation detail go to the log, so a fault can be traced without
 * exposing internals. Whoever raised the error, the client sees the failure
 * table's text for it, never a framework's own.
 *
 * The first match wins:
 *
 * 1. `ZodValidationException` (a subclass of `HttpException`, so it must come
 *    first): 400, the issues go to the debug log;
 * 2. `AppError`: its own status and message;
 * 3. any other `HttpException` (a guard's `UnauthorizedException`, a route that
 *    does not exist): the table message for its status, and a 5xx is logged;
 * 4. an error with a framework status (Fastify's body limit, media type): the
 *    same;
 * 5. a dependency outage: 503, not 500, because a client should retry a 503 and
 *    report a 500;
 * 6. anything else: logged with its whole cause chain, answered with the fixed 500.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    logger.setContext(AllExceptionsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const origin = this.originOf(http.getRequest<FastifyRequest | undefined>());

    const send = (status: number, message: string): void => {
      const body: ErrorBody = { success: false, payload: { message } };
      void reply.status(status).send(body);
    };

    if (exception instanceof ZodValidationException) {
      this.logger.debug(
        { ...origin, issues: exception.getZodError() },
        'request failed validation',
      );
      send(FAILURES.invalidRequest.status, FAILURES.invalidRequest.message);
      return;
    }

    if (exception instanceof AppError) {
      send(exception.status, exception.message);
      return;
    }

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : frameworkStatus(exception);
    if (status !== undefined) {
      if (status >= 500)
        this.report(exception, status, origin, 'framework error');
      const entry = failureForStatus(status);
      send(entry.status, entry.message);
      return;
    }

    if (isDependencyOutage(exception)) {
      this.report(
        exception,
        FAILURES.unavailable.status,
        origin,
        'dependency unreachable',
      );
      send(FAILURES.unavailable.status, FAILURES.unavailable.message);
      return;
    }

    this.report(exception, FAILURES.internal.status, origin, 'unhandled error');
    send(FAILURES.internal.status, FAILURES.internal.message);
  }

  /**
   * Records a fault with everything needed to find it again.
   *
   * @param exception - What was thrown.
   * @param statusCode - What the client is being told.
   * @param origin - Where the request was headed.
   * @param message - The one-line summary.
   */
  private report(
    exception: unknown,
    statusCode: number,
    origin: Origin,
    message: string,
  ): void {
    this.logger.error(
      { ...origin, statusCode, failure: describeFailure(exception) },
      message,
    );
  }

  /**
   * Reads where a request was headed, naming the route by its pattern.
   *
   * @param request - The incoming request, if there is one.
   * @returns What could be read.
   */
  private originOf(request: FastifyRequest | undefined): Origin {
    if (!request) return {};
    const origin: Origin = { requestId: request.id };
    if (request.method)
      origin.route = `${request.method} ${routePattern(request.raw)}`;
    return origin;
  }
}
