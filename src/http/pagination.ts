/**
 * Consistent pagination helpers for list endpoints.
 *
 * All list endpoints accept:
 *   - limit  (number, default 50, max 200)
 *   - cursor (opaque string, optional — used for cursor-based paging)
 *   - offset (number, optional — used as a simpler alternative to cursor)
 *
 * All list endpoints return a consistent wrapper via paginatedResponse().
 */

export interface PaginationParams {
  limit: number;
  cursor?: string;
  offset?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: {
    limit: number;
    offset?: number;
    next_cursor?: string;
    total?: number;
  };
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Parse pagination query params from a plain object (e.g. c.req.queries()).
 * Safe to call with any query string dict — unknown keys are ignored.
 */
export function parsePagination(query: Record<string, string | string[] | undefined>): PaginationParams {
  const rawLimit = Array.isArray(query.limit) ? query.limit[0] : query.limit;
  const rawCursor = Array.isArray(query.cursor) ? query.cursor[0] : query.cursor;
  const rawOffset = Array.isArray(query.offset) ? query.offset[0] : query.offset;

  const parsed = rawLimit !== undefined ? parseInt(rawLimit, 10) : DEFAULT_LIMIT;
  const limit = Number.isNaN(parsed) || parsed < 1
    ? DEFAULT_LIMIT
    : Math.min(parsed, MAX_LIMIT);

  const cursor = rawCursor !== undefined && rawCursor !== '' ? rawCursor : undefined;

  const parsedOffset = rawOffset !== undefined ? parseInt(rawOffset, 10) : undefined;
  const offset = parsedOffset !== undefined && !Number.isNaN(parsedOffset) ? parsedOffset : undefined;

  return { limit, cursor, offset };
}

/**
 * Wrap a page of items in the standard paginated envelope.
 *
 * @param items      The page of items to return
 * @param params     The pagination params used to fetch this page
 * @param nextCursor Opaque cursor for the next page, or undefined if this is the last page
 * @param total      Optional total count (omit if expensive)
 */
export function paginatedResponse<T>(
  items: T[],
  params: PaginationParams,
  nextCursor?: string,
  total?: number
): PaginatedResult<T> {
  return {
    items,
    pagination: {
      limit: params.limit,
      ...(params.offset !== undefined ? { offset: params.offset } : {}),
      ...(nextCursor !== undefined ? { next_cursor: nextCursor } : {}),
      ...(total !== undefined ? { total } : {}),
    },
  };
}
