/**
 * Faithful stand-ins for the two SDK shapes the unit tests fake most often.
 *
 * Both used to be ad-hoc object literals, and both were wrong in ways that hid
 * real defects (AUDIT #5 and #6):
 *
 *  - a *connection* was faked as `{ nodes }`, or with a `fetchNext()` that
 *    returned a **fresh object**. The SDK's `fetchNext()` appends to
 *    `this.nodes`, mutates `this.pageInfo` in place, and returns `this`. The
 *    difference is exactly what let `milestone view` report
 *    `issuesTruncated: false` while hiding issues and still pass its test.
 *  - a *mutation payload* was faked without `success`, so a service that never
 *    checked `success` looked correct. Every real Linear payload carries a
 *    non-null `success: Boolean!`.
 *
 * Tests that fake either shape should build it here, so a future service change
 * meets the SDK's semantics rather than a convenient fiction.
 */

export interface FakeConnection<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor?: string };
  fetchNext: () => Promise<FakeConnection<T>>;
}

/**
 * A connection over `all`, serving `per` nodes per page (default: one page).
 * `fetchNext()` mutates and returns `this`, exactly as the SDK's does.
 */
export function connection<T>(all: T[], per = all.length): FakeConnection<T> {
  const size = Math.max(per, 1);
  let served = Math.min(size, all.length);
  const conn: FakeConnection<T> = {
    nodes: all.slice(0, served),
    pageInfo: { hasNextPage: served < all.length, endCursor: `c${served}` },
    async fetchNext() {
      if (!this.pageInfo.hasNextPage) return this;
      const next = all.slice(served, served + size);
      served += next.length;
      this.nodes = [...this.nodes, ...next];
      this.pageInfo.hasNextPage = served < all.length;
      this.pageInfo.endCursor = `c${served}`;
      return this;
    },
  };
  return conn;
}

/** A payload as the SDK returns it: `success` plus whatever else it carries. */
export interface FakePayload {
  success: boolean;
  lastSyncId: number;
  [key: string]: any;
}

/** A successful mutation payload carrying its entity, as the SDK returns it. */
export function payload<T>(key: string, entity: T): FakePayload {
  return { success: true, lastSyncId: 1, [key]: Promise.resolve(entity) };
}

/** A successful mutation payload with no entity of its own (deletes, archives, …). */
export function okPayload(): FakePayload {
  return { success: true, lastSyncId: 1 };
}

/** A mutation the API refused: `success: false`, and no entity to hand back. */
export function failedPayload(key?: string): FakePayload {
  return { success: false, lastSyncId: 1, ...(key ? { [key]: Promise.resolve(null) } : {}) };
}

/**
 * One page of a raw GraphQL connection, as `rawRequest` returns it: `nodes`
 * plus `pageInfo { hasNextPage endCursor }`, cut from `all` at the opaque
 * cursor `after` (which this fake spells `c<offset>`). Fakes of the tailored
 * detail/list queries serve pages with this so pagination is exercised against
 * the shape the wire actually has.
 */
export function rawPage<T>(
  all: T[],
  vars: { first: number; after?: string | null },
): { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } {
  const offset = vars.after ? Number.parseInt(String(vars.after).replace(/^c/, ""), 10) : 0;
  const nodes = all.slice(offset, offset + vars.first);
  const end = offset + nodes.length;
  return {
    nodes,
    pageInfo: { hasNextPage: end < all.length, endCursor: nodes.length ? `c${end}` : null },
  };
}
