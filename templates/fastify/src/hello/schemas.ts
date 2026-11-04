import { z } from 'zod';

import { successEnvelope } from '../common/http/envelope.js';

/** The `data` of `GET /api/v1/hello`. */
export const helloDataSchema = z.object({ message: z.string() });

/** The whole body of `GET /api/v1/hello`, declared as the route's response. */
export const helloResponseSchema = successEnvelope(helloDataSchema);

/** The `data` of the hello route. */
export type HelloData = z.infer<typeof helloDataSchema>;
