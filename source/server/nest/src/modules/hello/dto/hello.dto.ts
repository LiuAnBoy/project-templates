import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** The `data` of `GET /api/v1/hello`. */
export const helloDataSchema = z.object({ message: z.string() });

/** The shape of the hello answer; the zod schema is the contract. */
export class HelloDto extends createZodDto(helloDataSchema) {}
