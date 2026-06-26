import { describe, it, expect, vi } from "bun:test";
import {
  toRow,
  listRoadmaps,
  createRoadmap,
  updateRoadmap,
  deleteRoadmap,
  getRoadmapDetail,
} from "../../src/services/roadmap.js";

/** A connection-like object as the SDK returns it (no more pages). */
function conn<T>(nodes: T[]) {
  return { nodes, pageInfo: { hasNextPage: false }, fetchNext: async () => conn(nodes) };
}

describe("toRow", () => {
  it("projects a roadmap to the row shape, normalizing missing description", () => {
    expect(toRow({ id: "r1", name: "H1", description: null, url: "u" })).toEqual({
      id: "r1",
      name: "H1",
      description: null,
      url: "u",
    });
    expect(toRow({ id: "r2", name: "H2", url: "u2" }).description).toBeNull();
  });
});

describe("listRoadmaps", () => {
  it("maps the connection nodes to rows", async () => {
    const client = {
      roadmaps: vi.fn(async () =>
        conn([{ id: "r1", name: "H1", description: "d", url: "u" }]),
      ),
    } as any;
    const rows = await listRoadmaps(client, 50);
    expect(rows).toEqual([{ id: "r1", name: "H1", description: "d", url: "u" }]);
    expect(client.roadmaps).toHaveBeenCalledWith({ first: 50 });
  });
});

describe("createRoadmap", () => {
  it("builds an input with name + description and unwraps the payload", async () => {
    const created = { id: "r9", name: "New", url: "u" };
    const client = {
      createRoadmap: vi.fn(async (input: any) => {
        expect(input).toEqual({ name: "New", description: "desc" });
        return { roadmap: Promise.resolve(created) };
      }),
    } as any;
    const out = await createRoadmap(client, { name: "New", description: "desc" });
    expect(out).toBe(created as any);
  });

  it("resolves owner 'me' to the viewer id", async () => {
    const client = {
      viewer: Promise.resolve({ id: "viewer-id" }),
      createRoadmap: vi.fn(async (input: any) => {
        expect(input.ownerId).toBe("viewer-id");
        return { roadmap: Promise.resolve({ id: "r1", name: "x", url: "u" }) };
      }),
    } as any;
    await createRoadmap(client, { name: "x", owner: "me" });
    expect(client.createRoadmap).toHaveBeenCalled();
  });

  it("throws a usage error when the payload has no roadmap", async () => {
    const client = {
      createRoadmap: vi.fn(async () => ({ roadmap: Promise.resolve(null) })),
    } as any;
    await expect(createRoadmap(client, { name: "x" })).rejects.toMatchObject({ code: "usage" });
  });
});

describe("updateRoadmap", () => {
  it("throws a usage error when no fields are given (id input)", async () => {
    const uuid = "01234567-89ab-cdef-0123-456789abcdef";
    const client = {
      roadmap: vi.fn(async () => ({ id: uuid, name: "x" })),
    } as any;
    await expect(updateRoadmap(client, uuid, {})).rejects.toMatchObject({ code: "usage" });
  });

  it("resolves a roadmap by name then updates it", async () => {
    const client = {
      roadmaps: vi.fn(async () => conn([{ id: "r1", name: "H1" }])),
      updateRoadmap: vi.fn(async (id: string, input: any) => {
        expect(id).toBe("r1");
        expect(input).toEqual({ name: "H1 renamed" });
        return { roadmap: Promise.resolve({ id: "r1", name: "H1 renamed" }) };
      }),
    } as any;
    const out = await updateRoadmap(client, "h1", { name: "H1 renamed" });
    expect(out.name).toBe("H1 renamed");
  });
});

describe("name resolution", () => {
  it("errors not_found when no roadmap matches the name", async () => {
    const client = { roadmaps: vi.fn(async () => conn([{ id: "r1", name: "Other" }])) } as any;
    await expect(deleteRoadmap(client, "missing")).rejects.toMatchObject({ code: "not_found" });
  });

  it("errors ambiguous when multiple roadmaps share a name", async () => {
    const client = {
      roadmaps: vi.fn(async () =>
        conn([
          { id: "r1", name: "Dup" },
          { id: "r2", name: "dup" },
        ]),
      ),
    } as any;
    await expect(getRoadmapDetail(client, "dup")).rejects.toMatchObject({ code: "ambiguous" });
  });
});
