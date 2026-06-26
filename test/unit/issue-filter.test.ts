import { describe, it, expect } from "bun:test";
import { buildFilter, sortSpec } from "../../src/services/issue.js";

const client = {
  viewer: Promise.resolve({ id: "viewer-id" }),
} as any;

describe("buildFilter", () => {
  it("filters by team key (uppercased)", async () => {
    expect(await buildFilter(client, { team: "tes" }, undefined)).toEqual({
      team: { key: { eq: "TES" } },
    });
  });

  it("uses the default team when none given", async () => {
    expect(await buildFilter(client, {}, "ENG")).toEqual({ team: { key: { eq: "ENG" } } });
  });

  it("filters a workflow state by type when it is a known type", async () => {
    const f = await buildFilter(client, { state: "started" }, undefined);
    expect(f.state).toEqual({ type: { eq: "started" } });
  });

  it("filters a workflow state by name otherwise", async () => {
    const f = await buildFilter(client, { state: "In Progress" }, undefined);
    expect(f.state).toEqual({ name: { eqIgnoreCase: "In Progress" } });
  });

  it("resolves assignee 'me' to the viewer id", async () => {
    const f = await buildFilter(client, { assignee: "me" }, undefined);
    expect(f.assignee).toEqual({ id: { eq: "viewer-id" } });
  });

  it("filters by priority as an integer", async () => {
    const f = await buildFilter(client, { priority: "2" }, undefined);
    expect(f.priority).toEqual({ eq: 2 });
  });

  it("filters by labels using a 'some' collection match", async () => {
    const f = await buildFilter(client, { label: ["bug", "ui"] }, undefined);
    expect(f.labels).toEqual({ some: { name: { in: ["bug", "ui"] } } });
  });

  it("filters by free-text query against searchable content", async () => {
    const f = await buildFilter(client, { query: "crash" }, undefined);
    expect(f.searchableContent).toEqual({ contains: "crash" });
  });

  it("passes a cycle uuid through directly", async () => {
    const uuid = "01234567-89ab-cdef-0123-456789abcdef";
    const f = await buildFilter(client, { cycle: uuid }, undefined);
    expect(f.cycle).toEqual({ id: { eq: uuid } });
  });

  it("throws a usage error for a cycle number without a team", async () => {
    await expect(buildFilter(client, { cycle: "3" }, undefined)).rejects.toMatchObject({
      code: "usage",
    });
  });
});

describe("sortSpec (server-side, correct under pagination)", () => {
  it("orders priority by urgency descending (Urgent first), no-priority last", () => {
    expect(sortSpec("priority")).toEqual([
      { priority: { order: "Descending", noPriorityFirst: false } },
    ]);
  });
  it("defaults to updatedAt descending", () => {
    expect(sortSpec(undefined)).toEqual([{ updatedAt: { order: "Descending" } }]);
  });
  it("supports createdAt", () => {
    expect(sortSpec("created")).toEqual([{ createdAt: { order: "Descending" } }]);
  });
});
