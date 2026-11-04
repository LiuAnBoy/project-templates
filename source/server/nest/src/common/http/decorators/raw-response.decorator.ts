import { SetMetadata } from '@nestjs/common';

/** Metadata key `ResponseEnvelopeInterceptor` reads to leave a body alone. */
export const IS_RAW_RESPONSE = 'app:raw-response';

/**
 * Sends this endpoint's result exactly as the handler produced it.
 *
 * For the three exceptions the envelope allows: downloads and streams, health
 * and readiness probes that answer a bare status, and a machine caller that
 * expects a bare status. Note the reason in the route's doc comment.
 *
 * @returns A method or class decorator.
 */
export const RawResponse = () => SetMetadata(IS_RAW_RESPONSE, true);
