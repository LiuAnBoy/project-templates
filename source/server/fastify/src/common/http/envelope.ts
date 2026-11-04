import { z } from 'zod';

/** The largest page a list may ask for. */
export const MAX_PAGE_SIZE = 100;

/** The success shape of a single object or array. */
export type SuccessBody<T> = { success: true; payload: { data: T } };

/** The success shape of a list: paging fields sit beside `data`, in snake_case. */
export type PagedBody<T> = {
  success: true;
  payload: { data: T[]; page: number; page_size: number; total_count: number };
};

/** The failure shape: a message and nothing else. */
export type FailureBody = { success: false; payload: { message: string } };

/**
 * Wraps data in the success envelope. The only place a success body is built.
 *
 * @param data - What the route answers; `undefined` (a delete, say) becomes `{}`.
 * @returns The envelope.
 */
export function success(): SuccessBody<Record<string, never>>;
export function success<T>(data: T): SuccessBody<T>;
export function success(data?: unknown): SuccessBody<unknown> {
  return { success: true, payload: { data: data ?? {} } };
}

/**
 * Wraps one page of a list in the paged envelope.
 *
 * @param data - The items on this page.
 * @param page - The page served, starting at 1.
 * @param pageSize - The effective page size, after clamping to `MAX_PAGE_SIZE`.
 * @param totalCount - How many items match over all pages.
 * @returns The envelope.
 */
export function paginated<T>(
  data: T[],
  page: number,
  pageSize: number,
  totalCount: number,
): PagedBody<T> {
  return {
    success: true,
    payload: { data, page, page_size: pageSize, total_count: totalCount },
  };
}

/**
 * Builds the failure envelope. The only place a failure body is built.
 *
 * @param message - A fixed message from the failure table.
 * @returns The envelope.
 */
export function failure(message: string): FailureBody {
  return { success: false, payload: { message } };
}

/**
 * Declares the success envelope around a route's data schema, for `response`.
 *
 * @param data - Schema of the route's `data`.
 * @returns The schema of the whole body.
 */
export function successEnvelope<T extends z.ZodType>(data: T) {
  return z.object({ success: z.literal(true), payload: z.object({ data }) });
}

/**
 * Declares the paged envelope around the schema of one list item.
 *
 * @param item - Schema of one item.
 * @returns The schema of the whole body.
 */
export function pagedEnvelope<T extends z.ZodType>(item: T) {
  return z.object({
    success: z.literal(true),
    payload: z.object({
      data: z.array(item),
      page: z.number().int().min(1),
      page_size: z.number().int().min(1).max(MAX_PAGE_SIZE),
      total_count: z.number().int().min(0),
    }),
  });
}

/** Query parameters every list route accepts; `page_size` is clamped, not rejected. */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce
    .number()
    .int()
    .min(1)
    .default(20)
    .transform((size) => Math.min(size, MAX_PAGE_SIZE)),
});
