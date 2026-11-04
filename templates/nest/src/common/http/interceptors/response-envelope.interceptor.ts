import {
  Injectable,
  StreamableFile,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';

import { IS_RAW_RESPONSE } from '../decorators/raw-response.decorator.js';
import { Paginated } from '../response.js';

type Envelope = { success: true; payload: Record<string, unknown> };

/**
 * Wraps every successful response in the shared envelope.
 *
 * Controllers return their data plain; `paginated()` adds the page fields. Doing
 * it here rather than in each handler keeps the shape identical across every
 * endpoint, including the ones nobody has written yet. A handler that returns
 * nothing answers `data: {}`. A `StreamableFile` and any handler marked
 * `@RawResponse()` pass through untouched.
 *
 * Failures never reach this: they go through `AllExceptionsFilter`.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Envelope | StreamableFile | unknown> {
    const raw = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_RAW_RESPONSE,
      [context.getHandler(), context.getClass()],
    );
    if (raw) return next.handle();

    return next.handle().pipe(
      map((result: unknown): Envelope | StreamableFile => {
        if (result instanceof StreamableFile) return result;

        if (result instanceof Paginated) {
          return {
            success: true,
            payload: {
              data: result.data,
              page: result.meta.page,
              page_size: result.meta.page_size,
              total_count: result.meta.total_count,
            },
          };
        }

        return { success: true, payload: { data: result ?? {} } };
      }),
    );
  }
}
