/**
 * Reads `page` and `limit` from a query object.
 * @returns {{ page: number, limit: number, skip: number }}
 */
export function pageParams(query = {}, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

/** The standard list response: `{ items, total, page, limit, pages }`. */
export function paged(items, total, { page, limit }) {
  return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

/** Runs a paginated find + count in parallel and returns the standard list response. */
export async function paginate(query, countQuery, params, map = (x) => x) {
  const [items, total] = await Promise.all([query.skip(params.skip).limit(params.limit), countQuery]);
  return paged(items.map(map), total, params);
}
