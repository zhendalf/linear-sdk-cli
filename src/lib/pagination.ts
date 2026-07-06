/**
 * Iterate a Linear SDK connection up to `limit`, following `fetchNext`.
 *
 * The SDK's connection objects expose `.nodes` and `.pageInfo.hasNextPage`,
 * and `.fetchNext()` mutates the connection to append the next page's nodes.
 */

import { withRetry } from "../client.js";

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

/** A GraphQL connection page as returned by a raw query. */
interface RawConnection {
  nodes: any[];
  pageInfo: { hasNextPage: boolean; endCursor?: string };
}

/** A client exposing the low-level GraphQL `rawRequest`. */
interface RawClient {
  client: { rawRequest: (query: string, variables: Record<string, any>) => Promise<{ data: any }> };
}

/**
 * Run a cursor-paginated raw GraphQL query, collecting transformed nodes up to
 * `limit`. The query must take `$first: Int!` and `$after: String` and return a
 * connection (`{ nodes, pageInfo { hasNextPage endCursor } }`) reachable at
 * `connectionPath` (a dot path) within `data.data`. Each call is wrapped in
 * `withRetry`; pagination stops at `limit` or when `hasNextPage` is false.
 *
 * Mirrors the hand-rolled loops in the list services exactly: page size is
 * `limit === Infinity ? 100 : Math.min(limit, 100)`, and rows are capped at
 * `limit` mid-page.
 */
export async function collectRawQuery<T>(
  client: RawClient,
  query: string,
  variables: Record<string, any>,
  connectionPath: string,
  limit: number,
  transform: (node: any) => T,
): Promise<T[]> {
  const pageLimit = limit === Infinity ? 100 : Math.min(limit, 100);
  const rows: T[] = [];
  let after: string | undefined;

  for (;;) {
    const data: any = await withRetry(() =>
      client.client.rawRequest(query, { ...variables, first: pageLimit, after }),
    );
    const conn = connectionPath
      .split(".")
      .reduce((acc: any, key) => acc?.[key], data.data) as RawConnection;
    for (const n of conn.nodes) {
      rows.push(transform(n));
      if (rows.length >= limit) break;
    }
    if (rows.length >= limit || !conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return rows;
}
