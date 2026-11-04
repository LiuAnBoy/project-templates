/** Paging fields of a list answer, in snake_case as on the wire. */
export type PaginationMeta = {
  /** The page served, starting at 1. */
  page: number;
  /** The effective page size, after clamping to `MAX_PAGE_SIZE`. */
  page_size: number;
  /** How many items match over all pages. */
  total_count: number;
};

/** The largest page a list may ask for. */
export const MAX_PAGE_SIZE = 100;

/**
 * A page of a list, plus the counts the client needs to page through it.
 *
 * Controllers return their data plain and the envelope interceptor wraps it;
 * this marker is the one case where the envelope needs more than the data.
 */
export class Paginated<T> {
  constructor(
    readonly data: T[],
    readonly meta: PaginationMeta,
  ) {}
}

/**
 * Marks a response as one page of a list.
 *
 * @param data - The items on this page.
 * @param meta - Page number, page size and the total row count.
 * @returns The marker the interceptor understands.
 */
export function paginated<T>(data: T[], meta: PaginationMeta): Paginated<T> {
  return new Paginated(data, meta);
}
