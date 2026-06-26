import { describe, it, expect } from "bun:test";
import { findConnection } from "../../src/commands/api.js";

describe("findConnection", () => {
  it("finds a top-level connection", () => {
    const data = { nodes: [1, 2], pageInfo: { hasNextPage: false } };
    expect(findConnection(data)?.nodes).toEqual([1, 2]);
  });

  it("finds a nested connection (e.g. data.issues)", () => {
    const data = { issues: { nodes: ["a"], pageInfo: { endCursor: "x" } } };
    expect(findConnection(data)?.nodes).toEqual(["a"]);
  });

  it("returns undefined when there is no connection", () => {
    expect(findConnection({ viewer: { id: "1" } })).toBeUndefined();
    expect(findConnection(null)).toBeUndefined();
  });
});
