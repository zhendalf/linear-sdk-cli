import { describe, it, expect } from "bun:test";
import {
  collect,
  collectWithMore,
  pageSize,
  pageSizeForMore,
  type Connection,
} from "../../src/lib/pagination.js";
import { connection } from "./_fakes.js";

/**
 * A connection over `total` items, `per` per page — faithful to the SDK, whose
 * `fetchNext()` appends to `this.nodes`, mutates `this.pageInfo` and returns
 * `this`. The previous fake returned a **fresh object** from `fetchNext()`,
 * which made every multi-page assertion here weaker than it looked and hid
 * AUDIT #5 in `milestone view`.
 */
function fakeConnection(total: number, per: number): Connection<number> {
  return connection(
    Array.from({ length: total }, (_, i) => i),
    per,
  ) as Connection<number>;
}

describe("collect", () => {
  it("stops at the requested limit without over-fetching", async () => {
    const got = await collect(fakeConnection(100, 10), 25);
    expect(got).toHaveLength(25);
    expect(got[0]).toBe(0);
  });

  it("exhausts all pages when limit is Infinity", async () => {
    const got = await collect(fakeConnection(33, 10), Infinity);
    expect(got).toHaveLength(33);
  });

  it("returns fewer than limit when the source is small", async () => {
    const got = await collect(fakeConnection(3, 10), 50);
    expect(got).toHaveLength(3);
  });

  it("follows pages in order, without duplicating the page boundary", async () => {
    const got = await collect(fakeConnection(25, 10), Infinity);
    expect(got).toEqual(Array.from({ length: 25 }, (_, i) => i));
  });
});

describe("collectWithMore", () => {
  it("reports more when the source outruns the limit", async () => {
    const { items, hasMore } = await collectWithMore(fakeConnection(180, 100), 150);
    expect(items).toHaveLength(150);
    expect(hasMore).toBe(true);
  });

  it("does not report more when the source lands exactly on the limit", async () => {
    const { items, hasMore } = await collectWithMore(fakeConnection(150, 100), 150);
    expect(items).toHaveLength(150);
    expect(hasMore).toBe(false);
  });

  it("does not report more when the source is smaller than the limit", async () => {
    const { items, hasMore } = await collectWithMore(fakeConnection(4, 100), 50);
    expect(items).toHaveLength(4);
    expect(hasMore).toBe(false);
  });

  it("never reports more under Infinity", async () => {
    const { items, hasMore } = await collectWithMore(fakeConnection(230, 100), Infinity);
    expect(items).toHaveLength(230);
    expect(hasMore).toBe(false);
  });

  /**
   * The reason `collectWithMore` exists. After collection the connection has
   * been mutated past the point of answering "was anything hidden?" — its own
   * `hasNextPage` describes the last page fetched. Asserting that directly
   * keeps the wrong fix from looking right later.
   */
  it("is not the same answer as the connection's own hasNextPage after collecting", async () => {
    const conn = fakeConnection(180, 100);
    const { hasMore } = await collectWithMore(conn, 150);
    expect(hasMore).toBe(true);
    // 180 items, 100 per page: two pages cover everything, so the connection
    // now says there is no next page — while 30 items are still hidden.
    expect(conn.pageInfo.hasNextPage).toBe(false);
  });
});

describe("pageSize", () => {
  it("caps at 100", () => {
    expect(pageSize(500)).toBe(100);
    expect(pageSize(Infinity)).toBe(100);
  });
  it("requests at least 1", () => {
    expect(pageSize(0)).toBe(1);
  });
  it("uses the limit when reasonable", () => {
    expect(pageSize(25)).toBe(25);
  });
});

describe("pageSizeForMore", () => {
  it("leaves room for the sentinel item", () => {
    expect(pageSizeForMore(25)).toBe(26);
    expect(pageSizeForMore(1)).toBe(2);
  });
  it("still respects the page cap and Infinity", () => {
    expect(pageSizeForMore(100)).toBe(100);
    expect(pageSizeForMore(Infinity)).toBe(100);
  });
});
