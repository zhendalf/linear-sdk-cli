import { describe, it, expect } from "bun:test";
import { collect, pageSize, type Connection } from "../../src/lib/pagination.js";

/** Build a fake connection over `total` items, `per` per page. */
function fakeConnection(total: number, per: number): Connection<number> {
  function make(start: number): Connection<number> {
    const nodesSoFar = Array.from({ length: Math.min(start + per, total) }, (_, i) => i);
    return {
      nodes: nodesSoFar,
      pageInfo: { hasNextPage: nodesSoFar.length < total },
      fetchNext: async () => make(start + per),
    };
  }
  return make(0);
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
