/**
 * Iterate a Linear SDK connection up to `limit`, following `fetchNext`.
 *
 * The SDK's connection objects expose `.nodes` and `.pageInfo.hasNextPage`,
 * and `.fetchNext()` mutates the connection to append the next page's nodes.
 */

import { fetchNextWithRetry, withRetry } from "../client.js";

/** Linear accepts at most 250 nodes per connection page. */
export const MAX_PAGE_SIZE = 250;

export interface Connection<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean };
  fetchNext: () => Promise<Connection<T>>;
}

/** Non-enumerable metadata carried by list arrays without changing their JSON contract. */
const HAS_MORE = Symbol.for("linear-sdk-cli.pagination.has-more");

type PagedArray<T> = T[] & { [HAS_MORE]?: boolean };

function withMoreMetadata<T>(items: T[], hasMore: boolean): T[] {
  Object.defineProperty(items, HAS_MORE, { value: hasMore, enumerable: false });
  return items;
}

/** Attach an explicit pagination result to an array without changing its JSON value. */
export function setPaginationMetadata<T>(items: T[], hasMore: boolean): T[] {
  return withMoreMetadata(items, hasMore);
}

/** Whether a service list stopped at its caller-supplied limit. */
export function hasMoreResults(items: readonly unknown[]): boolean {
  return (items as PagedArray<unknown>)[HAS_MORE] === true;
}

/** Carry pagination metadata through a service's map/filter/sort result. */
export function inheritPaginationMetadata<T>(items: T[], source: readonly unknown[]): T[] {
  return withMoreMetadata(items, hasMoreResults(source));
}

export async function collect<T>(first: Connection<T>, limit: number): Promise<T[]> {
  let conn = first;
  // Each fetchNext() appends to conn.nodes in place.
  while (conn.nodes.length < limit && conn.pageInfo.hasNextPage) {
    // Page two and later are independent requests and can be rate-limited just
    // like page one. Keep them behind the same bounded retry policy.
    conn = await fetchNextWithRetry(conn);
  }
  if (limit === Infinity) return withMoreMetadata(conn.nodes, false);
  const hasMore =
    conn.nodes.length > limit || (conn.nodes.length >= limit && conn.pageInfo.hasNextPage);
  return withMoreMetadata(conn.nodes.slice(0, limit), hasMore);
}

/** How many to request per page given a desired total limit. */
export function pageSize(limit: number): number {
  if (limit === Infinity) return MAX_PAGE_SIZE;
  return Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
}

/**
 * `collect`, plus an honest answer to "were there more?".
 *
 * The connection cannot answer that after the fact: `fetchNext()` mutates the
 * connection in place, so once collection stops at `limit` the object's
 * `pageInfo.hasNextPage` describes the *last page fetched*, not the items the
 * limit hid. Reading it post-collection reports "nothing was hidden" precisely
 * when the final page happened to be the last one — which is the common case.
 *
 * So we ask for one more than we need and let the extra item be the evidence.
 * Callers should size the first page with `pageSizeForMore(limit)` so the
 * spare slot costs no extra request.
 */
export async function collectWithMore<T>(
  conn: Connection<T>,
  limit: number,
): Promise<{ items: T[]; hasMore: boolean }> {
  const nodes = await collect(conn, limit + 1);
  return { items: nodes.slice(0, limit), hasMore: nodes.length > limit };
}

/** Page size for a `collectWithMore(limit)`: room for the sentinel item. */
export function pageSizeForMore(limit: number): number {
  return pageSize(limit === Infinity ? Infinity : limit + 1);
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
 * `limit === Infinity ? 250 : Math.min(limit, 250)`, and rows are capped at
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
  const pageLimit = pageSize(limit);
  const rows: T[] = [];
  let after: string | undefined;
  let hasMore = false;

  for (;;) {
    const data: any = await withRetry(() =>
      client.client.rawRequest(query, { ...variables, first: pageLimit, after }),
    );
    const conn = connectionPath.split(".").reduce((acc: any, key) => acc?.[key], data.data) as
      | RawConnection
      | null
      | undefined;
    // A nested path (`issue.comments`) can land on null when the parent entity
    // is gone; that is an empty list, not a crash.
    if (!conn) break;
    for (const [index, n] of conn.nodes.entries()) {
      rows.push(transform(n));
      if (rows.length >= limit) {
        hasMore = index < conn.nodes.length - 1 || conn.pageInfo.hasNextPage;
        break;
      }
    }
    if (rows.length >= limit || !conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return withMoreMetadata(rows, hasMore);
}
