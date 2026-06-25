/**
 * Iterate a Linear SDK connection up to `limit`, following `fetchNext`.
 *
 * The SDK's connection objects expose `.nodes` and `.pageInfo.hasNextPage`,
 * and `.fetchNext()` mutates the connection to append the next page's nodes.
 */

export interface Connection<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean };
  fetchNext: () => Promise<Connection<T>>;
}

export async function collect<T>(
  first: Connection<T>,
  limit: number,
): Promise<T[]> {
  let conn = first;
  // Each fetchNext() appends to conn.nodes in place.
  while (conn.nodes.length < limit && conn.pageInfo.hasNextPage) {
    conn = await conn.fetchNext();
  }
  return limit === Infinity ? conn.nodes : conn.nodes.slice(0, limit);
}

/** How many to request per page given a desired total limit. */
export function pageSize(limit: number): number {
  if (limit === Infinity) return 100;
  return Math.min(Math.max(limit, 1), 100);
}
