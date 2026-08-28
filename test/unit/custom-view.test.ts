import { describe, expect, it, vi } from "bun:test";
import {
  buildCreateCustomViewInput,
  buildUpdateCustomViewInput,
  createCustomView,
  deleteCustomView,
  getCustomViewDetail,
  listCustomViewResults,
  listCustomViews,
  resolveCustomView,
  updateCustomView,
} from "../../src/services/custom-view.js";
import { connection, failedPayload, okPayload, payload } from "./_fakes.js";

const UUID = "01234567-89ab-cdef-0123-456789abcdef";
const UUID_2 = "11234567-89ab-cdef-0123-456789abcdef";
const DATE = new Date("2026-08-28T10:00:00.000Z");

function view(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID,
    name: "Urgent",
    modelName: "Issue",
    shared: true,
    slugId: "urgent-abc",
    updatedAt: DATE,
    createdAt: DATE,
    archivedAt: null,
    description: "Important work",
    filterData: { priority: { eq: 1 } },
    projectFilterData: null,
    initiativeFilterData: null,
    feedItemFilterData: null,
    color: "#5e6ad2",
    icon: "🔥",
    owner: Promise.resolve({ id: "u1", displayName: "Owner" }),
    creator: Promise.resolve({ id: "u2", displayName: "Creator" }),
    team: Promise.resolve({ id: "t1", key: "ENG", name: "Engineering" }),
    ...overrides,
  };
}

describe("custom view discovery and reference resolution", () => {
  it("lists paginated views with stable owner/team/type fields", async () => {
    const client = {
      customViews: vi.fn(async () => connection([view(), view({ id: UUID_2, name: "Second" })], 1)),
    } as any;
    const rows = await listCustomViews(client, 2);
    expect(client.customViews).toHaveBeenCalledWith({ first: 2 });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: UUID,
      name: "Urgent",
      type: "issue",
      shared: true,
      owner: { id: "u1", displayName: "Owner" },
      team: { id: "t1", key: "ENG", name: "Engineering" },
      slugId: "urgent-abc",
      updatedAt: "2026-08-28T10:00:00.000Z",
    });
  });

  it("requires UUIDs instead of guessing from an incomplete name list", async () => {
    const client = { customView: vi.fn() } as any;
    await expect(resolveCustomView(client, "Urgent")).rejects.toMatchObject({ code: "usage" });
    expect(client.customView).not.toHaveBeenCalled();
    client.customView.mockResolvedValue(view());
    await expect(resolveCustomView(client, UUID)).resolves.toMatchObject({ id: UUID });
    expect(client.customView).toHaveBeenCalledWith(UUID);
  });

  it("shows the filter matching the view model", async () => {
    const project = view({
      modelName: "Project",
      projectFilterData: { health: { eq: "atRisk" } },
      filterData: {},
    });
    const client = { customView: vi.fn(async () => project) } as any;
    const detail = await getCustomViewDetail(client, UUID);
    expect(detail.type).toBe("project");
    expect(detail.filter).toEqual({ health: { eq: "atRisk" } });
    expect(detail.creator).toEqual({ id: "u2", displayName: "Creator" });
  });
});

describe("matched entities", () => {
  it("uses the typed issue relation and preserves pagination", async () => {
    const issues = connection(
      [
        { id: "i1", identifier: "ENG-1", title: "One", url: "https://linear.app/i1" },
        { id: "i2", identifier: "ENG-2", title: "Two", url: "https://linear.app/i2" },
      ],
      1,
    );
    const model: any = view({ issues: vi.fn(async () => issues) });
    const client = { customView: vi.fn(async () => model) } as any;
    const rows = await listCustomViewResults(client, UUID, 2);
    expect(model.issues).toHaveBeenCalledWith({ first: 2 });
    expect(rows).toEqual([
      { type: "issue", id: "i1", identifier: "ENG-1", name: "One", url: "https://linear.app/i1" },
      { type: "issue", id: "i2", identifier: "ENG-2", name: "Two", url: "https://linear.app/i2" },
    ]);
  });

  it("dispatches to project and initiative relations", async () => {
    for (const [modelName, method, type] of [
      ["Project", "projects", "project"],
      ["Initiative", "initiatives", "initiative"],
    ] as const) {
      const relation = vi.fn(async () =>
        connection([{ id: "x", name: "Matched", url: "https://linear.app/x" }]),
      );
      const model = view({ modelName, [method]: relation });
      const client = { customView: vi.fn(async () => model) } as any;
      expect(await listCustomViewResults(client, UUID, 50)).toEqual([
        {
          type,
          id: "x",
          identifier: null,
          name: "Matched",
          url: "https://linear.app/x",
        },
      ]);
      expect(relation).toHaveBeenCalledWith({ first: 50 });
    }
  });

  it("rejects feed-item views because the typed SDK model has no updates relation", async () => {
    const client = { customView: vi.fn(async () => view({ modelName: "FeedItem" })) } as any;
    await expect(listCustomViewResults(client, UUID, 50)).rejects.toMatchObject({ code: "usage" });
  });
});

describe("custom view inputs and mutations", () => {
  it("builds a typed create input with the chosen filter, owner, visibility, and scope", async () => {
    const client = {
      viewer: Promise.resolve({ id: "viewer-id" }),
      team: vi.fn(async () => ({ id: UUID_2, key: "ENG", name: "Engineering" })),
    } as any;
    const input = await buildCreateCustomViewInput(client, {
      name: "At risk",
      type: "project",
      filter: { health: { eq: "atRisk" } },
      description: "Needs attention",
      owner: "me",
      shared: false,
      scopeTeam: UUID_2,
    });
    expect(input).toEqual({
      name: "At risk",
      projectFilterData: { health: { eq: "atRisk" } },
      description: "Needs attention",
      ownerId: "viewer-id",
      shared: false,
      teamId: UUID_2,
    });
  });

  it("sets an empty typed filter so type round-trips even without --filter", async () => {
    expect(
      await buildCreateCustomViewInput({} as any, { name: "Portfolio", type: "initiative" }),
    ).toEqual({ name: "Portfolio", initiativeFilterData: {} });
  });

  it("rejects ambiguous create scopes", async () => {
    await expect(
      buildCreateCustomViewInput({} as any, {
        name: "x",
        type: "issue",
        scopeTeam: UUID,
        scopeProject: UUID_2,
      }),
    ).rejects.toMatchObject({ code: "usage" });
  });

  it("omits unspecified update fields and routes a filter using the existing type", async () => {
    expect(await buildUpdateCustomViewInput({} as any, view(), { name: "Renamed" })).toEqual({
      name: "Renamed",
    });
    expect(
      await buildUpdateCustomViewInput({} as any, view({ modelName: "Initiative" }), {
        filter: { status: { eq: "Active" } },
        clearDescription: true,
        clearColor: true,
        clearIcon: true,
        shared: false,
        clearTeamScope: true,
      }),
    ).toEqual({
      initiativeFilterData: { status: { eq: "Active" } },
      description: null,
      color: null,
      icon: null,
      shared: false,
      teamId: null,
    });
  });

  it("refuses an empty update and conflicting clear/set values", async () => {
    await expect(buildUpdateCustomViewInput({} as any, view(), {})).rejects.toMatchObject({
      code: "usage",
    });
    await expect(
      buildUpdateCustomViewInput({} as any, view(), {
        description: "x",
        clearDescription: true,
      }),
    ).rejects.toMatchObject({ code: "usage" });
  });

  it("calls the typed SDK mutation methods and checks payload success", async () => {
    const created = view({ id: UUID_2, name: "Created" });
    const createClient = {
      createCustomView: vi.fn(async () => payload("customView", created)),
    } as any;
    await expect(createCustomView(createClient, { name: "Created", type: "issue" })).resolves.toBe(
      created as any,
    );
    expect(createClient.createCustomView).toHaveBeenCalledWith({ name: "Created", filterData: {} });

    const changed = view({ name: "Changed" });
    const updateClient = {
      customView: vi.fn(async () => view()),
      updateCustomView: vi.fn(async () => payload("customView", changed)),
    } as any;
    await expect(updateCustomView(updateClient, UUID, { name: "Changed" })).resolves.toBe(
      changed as any,
    );
    expect(updateClient.updateCustomView).toHaveBeenCalledWith(UUID, { name: "Changed" });

    const deleteClient = {
      customView: vi.fn(async () => view()),
      deleteCustomView: vi.fn(async () => okPayload()),
    } as any;
    await expect(deleteCustomView(deleteClient, UUID)).resolves.toMatchObject({ id: UUID });
    expect(deleteClient.deleteCustomView).toHaveBeenCalledWith(UUID);

    deleteClient.deleteCustomView.mockResolvedValue(failedPayload());
    await expect(deleteCustomView(deleteClient, UUID)).rejects.toMatchObject({ code: "api" });
  });
});
