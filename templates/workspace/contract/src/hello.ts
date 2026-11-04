import { z } from 'zod';

/** The `data` of `GET /api/v1/hello`. */
export const helloDataSchema = z.object({ message: z.string() });

/** The whole body of `GET /api/v1/hello`: the success envelope around the data. */
export const helloResponseSchema = z.object({
  success: z.literal(true),
  payload: z.object({ data: helloDataSchema }),
});

/** The `data` of the hello route. */
export type HelloData = z.infer<typeof helloDataSchema>;

/** The whole body of the hello route. */
export type HelloResponse = z.infer<typeof helloResponseSchema>;
