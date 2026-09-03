import { describe, it, expect } from "bun:test";
import {
  resolveStatus,
  resolvePriority,
  priorityLabel,
  createInitiative,
  updateInitiative,
  buildFilter,
  listInitiatives,
  unarchiveInitiative,
  addProject,
  findProjectLink,
  removeProjectLink,
  resolveInitiative,
  getInitiativeDetail,
} from "../../src/services/initiative.js";
import { connection, okPayload, failedPayload, payload, rawPage } from "./_fakes.js";

describe("resolveStatus", () => {
  it("normalizes a lowercase status to the enum value", () => {
    expect(resolveStatus("active")).toBe("Active");
    expect(resolveStatus("planned")).toBe("Planned");
    expect(resolveStatus("COMPLETED")).toBe("Completed");
    expect(resolveStatus("canceled")).toBe("Canceled");
    expect(resolveStatus("proposed")).toBe("Proposed");
  });

  it("passes through an already-correct value", () => {
    expect(resolveStatus("Active")).toBe("Active");
  });

  it("throws a usage error for an unknown status", () => {
    expect(() => resolveStatus("bogus")).toThrowError(/Invalid status/);
    try {
      resolveStatus("bogus");
    } catch (err: any) {
      expect(err.code).toBe("usage");
    }
  });
});

describe("resolvePriority / priorityLabel", () => {
  it("accepts the whole 0-4 range", () => {
    expect([0, 1, 2, 3, 4].map(resolvePriority)).toEqual([0, 1, 2, 3, 4]);
  });

  it("rejects out-of-range and non-integer values with a usage error", () => {
    for (const bad of [-1, 5, 1.5]) {
      expect(() => resolvePriority(bad)).toThrowError(/Invalid priority/);
      expect(() => resolvePriority(bad)).toThrow(expect.objectContaining({ code: "usage" }));
    }
  });

  // Initiative, unlike Issue, exposes no priorityLabel field — we name it.
  it("names each priority", () => {
    expect([0, 1, 2, 3, 4].map(priorityLabel)).toEqual([
      "No priority",
      "Urgent",
      "High",
      "Medium",
      "Low",
    ]);
    expect(priorityLabel(null)).toBe("No priority");
  });
});

describe("createInitiative (mocked client)", () => {
  it("builds an input with name, description, owner id and status", async () => {
    let captured: any;
    const client = {
      users: () => Promise.resolve(connection([{ id: "owner-id", email: "a@b.c" }])),
      createInitiative: (input: any) => {
        captured = input;
        return Promise.resolve({
          success: true,
          initiative: Promise.resolve({ id: "i1", name: input.name }),
        });
      },
    } as any;

    const created = await createInitiative(client, {
      name: "Q3 Roadmap",
      description: "ship it",
      owner: "a@b.c",
      status: "active",
      targetDate: "2026-09-30",
    });

    expect(created).toEqual({ id: "i1", name: "Q3 Roadmap" } as any);
    expect(captured).toEqual({
      name: "Q3 Roadmap",
      description: "ship it",
      ownerId: "owner-id",
      status: "Active",
      targetDate: "2026-09-30",
    });
  });

  it("omits optional fields when not provided", async () => {
    let captured: any;
    const client = {
      createInitiative: (input: any) => {
        captured = input;
        return Promise.resolve({
          success: true,
          initiative: Promise.resolve({ id: "i2", name: input.name }),
        });
      },
    } as any;

    await createInitiative(client, { name: "Bare" });
    expect(captured).toEqual({ name: "Bare" });
  });

  it("fails when the payload carries no initiative", async () => {
    const client = {
      createInitiative: () => Promise.resolve({ success: true, initiative: Promise.resolve(null) }),
    } as any;
    await expect(createInitiative(client, { name: "x" })).rejects.toMatchObject({
      code: "api",
    });
  });
});

describe("updateInitiative (mocked client)", () => {
  const idClient = (overrides: any) =>
    ({
      // resolveInitiative: UUID path fetches directly.
      initiative: () => Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }),
      ...overrides,
    }) as any;

  it("throws a usage error when no fields are supplied", async () => {
    const client = idClient({});
    await expect(
      updateInitiative(client, "00000000-0000-4000-8000-000000000000", {}),
    ).rejects.toMatchObject({ code: "usage" });
  });

  // Initiative labels are their own workspace-scoped entity (public since SDK 88.2),
  // resolved through initiativeLabels — not the issue-label query.
  it("resolves label names to ids, skipping label groups", async () => {
    let captured: any;
    const client = idClient({
      initiativeLabels: (vars: any) =>
        Promise.resolve(
          connection(
            vars.filter.name.eqIgnoreCase === "platform"
              ? [
                  { id: "grp", name: "Platform", isGroup: true },
                  { id: "lbl", name: "platform", isGroup: false },
                ]
              : [{ id: "lbl2", name: "infra", isGroup: false }],
          ),
        ),
      updateInitiative: (_id: string, input: any) => {
        captured = input;
        return Promise.resolve({
          success: true,
          initiative: Promise.resolve({ id: "i1", name: "n" }),
        });
      },
    });

    await updateInitiative(client, "00000000-0000-4000-8000-000000000000", {
      priority: 2,
      label: ["platform", "infra"],
    });
    expect(captured).toEqual({ priority: 2, labelIds: ["lbl", "lbl2"] });
  });

  it("rejects an unknown label", async () => {
    const client = idClient({
      initiativeLabels: () => Promise.resolve(connection([])),
      updateInitiative: () =>
        Promise.resolve({ success: true, initiative: Promise.resolve({ id: "i1" }) }),
    });
    await expect(
      updateInitiative(client, "00000000-0000-4000-8000-000000000000", { label: ["nope"] }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("normalizes status on update", async () => {
    let captured: any;
    const client = idClient({
      updateInitiative: (_id: string, input: any) => {
        captured = input;
        return Promise.resolve({
          success: true,
          initiative: Promise.resolve({ id: "i1", name: "n" }),
        });
      },
    });
    await updateInitiative(client, "00000000-0000-4000-8000-000000000000", {
      status: "completed",
    });
    expect(captured).toEqual({ status: "Completed" });
  });
});

const UUID = "00000000-0000-4000-8000-000000000000";
const PROJ = "11111111-1111-4111-8111-111111111111";

/**
 * TES-603 / TES-642: `initiative list` filters. Ours lists every status by
 * default (the reference CLI lists Active only); `--status`, `--owner` and
 * `--include-archived` (or its compatibility alias `--archived`) widens from there.
 */
describe("initiative list filters", () => {
  const client = {
    users: async () => connection([{ id: "u1", email: "ada@x.io" }]),
  } as any;

  it("is empty when nothing is asked for", async () => {
    expect(await buildFilter(client, {})).toEqual({});
  });

  it("normalizes --status through the enum and resolves --owner to a user id", async () => {
    expect(await buildFilter(client, { status: "active", owner: "ada@x.io" })).toEqual({
      status: { eq: "Active" },
      owner: { id: { eq: "u1" } },
    });
  });

  it("rejects an unknown status before the round-trip", async () => {
    await expect(buildFilter(client, { status: "sideways" })).rejects.toMatchObject({
      code: "usage",
    });
  });

  it("passes filters and --include-archived through while preserving lifecycle fields", async () => {
    const seen: any[] = [];
    const c = {
      ...client,
      client: {
        rawRequest: async (_q: string, vars: any) => {
          seen.push(vars);
          return {
            data: {
              initiatives: rawPage(
                [
                  {
                    id: "i1",
                    name: "Old",
                    status: "Completed",
                    url: "u",
                    archivedAt: "2026-01-01T00:00:00.000Z",
                    trashed: true,
                  },
                ],
                vars,
              ),
            },
          };
        },
      },
    } as any;
    const rows = await listInitiatives(c, 50, {
      status: "completed",
      includeArchived: true,
    });
    expect(seen[0]).toMatchObject({
      filter: { status: { eq: "Completed" } },
      includeArchived: true,
    });
    expect(rows[0]).toMatchObject({
      id: "i1",
      status: "Completed",
      priority: 0,
      archivedAt: "2026-01-01T00:00:00.000Z",
      trashed: true,
    });
    // Without --include-archived the API default (live only) is made explicit.
    await listInitiatives(c, 50, {});
    expect(seen[1]).toMatchObject({ filter: {}, includeArchived: false });
  });
});

describe("initiative detail lifecycle", () => {
  it("keeps trashed distinct from archived in the detail shape", async () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    const client = {
      initiative: async () => ({
        id: UUID,
        name: "Gone",
        description: null,
        status: "Canceled",
        priority: 0,
        health: null,
        targetDate: null,
        color: null,
        icon: null,
        url: "u",
        createdAt: date,
        updatedAt: date,
        startedAt: null,
        completedAt: null,
        archivedAt: date,
        trashed: true,
        owner: Promise.resolve(null),
        creator: Promise.resolve(null),
        labels: async () => connection([]),
        projects: async () => connection([]),
      }),
    } as any;

    expect(await getInitiativeDetail(client, UUID)).toMatchObject({
      archivedAt: date.toISOString(),
      trashed: true,
    });
  });
});

describe("createInitiative / updateInitiative --icon/--color", () => {
  it("forwards icon and color on create and update", async () => {
    const inputs: any[] = [];
    const client = {
      initiative: async () => ({ id: UUID }),
      createInitiative: async (input: any) => (
        inputs.push(input),
        payload("initiative", { id: "i1" })
      ),
      updateInitiative: async (_id: string, input: any) => (
        inputs.push(input),
        payload("initiative", { id: "i1" })
      ),
    } as any;
    await createInitiative(client, { name: "N", icon: "Rocket", color: "#5E6AD2" });
    await updateInitiative(client, UUID, { color: "#000000" });
    expect(inputs).toEqual([{ name: "N", icon: "Rocket", color: "#5E6AD2" }, { color: "#000000" }]);
  });
});

/**
 * TES-603: `initiative unarchive`, `add-project`, `remove-project`. All three
 * are direct SDK mutations; the interesting parts are that unarchive looks
 * among archived initiatives (nothing else does), and that remove-project finds
 * the link on the project's side instead of paging the workspace-wide feed.
 */
describe("initiative unarchive", () => {
  it("resolves by name among archived initiatives, and asserts the payload", async () => {
    const seen: any[] = [];
    const client = {
      initiatives: async (vars: any) => {
        seen.push(vars);
        return connection([{ id: "i1", name: "Old", archivedAt: new Date("2026-01-01") }]);
      },
      unarchiveInitiative: async (id: string) => (seen.push({ unarchive: id }), okPayload()),
    } as any;
    const r = await unarchiveInitiative(client, "old");
    expect(seen[0].includeArchived).toBe(true);
    expect(seen[1]).toEqual({ unarchive: "i1" });
    expect(r).toMatchObject({ id: "i1", name: "Old" });
  });

  it("refuses an initiative that is not archived, before any mutation", async () => {
    let called = false;
    const client = {
      initiative: async () => ({ id: UUID, name: "Live", archivedAt: null }),
      unarchiveInitiative: async () => ((called = true), okPayload()),
    } as any;
    await expect(unarchiveInitiative(client, UUID)).rejects.toMatchObject({ code: "usage" });
    expect(called).toBe(false);
  });

  it("the other resolvers still see live initiatives only", async () => {
    const seen: any[] = [];
    const client = {
      initiatives: async (vars: any) => (seen.push(vars), connection([{ id: "i1", name: "Live" }])),
    } as any;
    await resolveInitiative(client, "live");
    expect(seen[0].includeArchived).toBe(false);
  });
});

describe("initiative add-project / remove-project", () => {
  function client(overrides: any = {}) {
    return {
      initiative: async () => ({ id: UUID, name: "Bets" }),
      project: async (id: string) => ({
        id,
        name: "API",
        initiativeToProjects: async () =>
          connection([
            { id: "link-other", initiativeId: "someone-else" },
            { id: "link-1", initiativeId: UUID },
          ]),
      }),
      ...overrides,
    } as any;
  }

  it("add-project sends both ids (and sortOrder only when given) and returns the link", async () => {
    const inputs: any[] = [];
    const c = client({
      createInitiativeToProject: async (input: any) => (
        inputs.push(input),
        payload("initiativeToProject", { id: "link-new" })
      ),
    });
    const link = await addProject(c, UUID, PROJ);
    expect(link).toEqual({
      id: "link-new",
      initiative: { id: UUID, name: "Bets" },
      project: { id: PROJ, name: "API" },
    });
    await addProject(c, UUID, PROJ, { sortOrder: 3 });
    expect(inputs).toEqual([
      { initiativeId: UUID, projectId: PROJ },
      { initiativeId: UUID, projectId: PROJ, sortOrder: 3 },
    ]);
  });

  it("add-project fails when the API refuses", async () => {
    const c = client({
      createInitiativeToProject: async () => failedPayload("initiativeToProject"),
    });
    await expect(addProject(c, UUID, PROJ)).rejects.toMatchObject({ code: "api" });
  });

  it("finds the link on the project's side and deletes exactly that one", async () => {
    const seen: string[] = [];
    const c = client({
      deleteInitiativeToProject: async (id: string) => (seen.push(id), okPayload()),
    });
    const link = await findProjectLink(c, UUID, PROJ);
    expect(link.id).toBe("link-1");
    await removeProjectLink(c, link);
    expect(seen).toEqual(["link-1"]);
  });

  it("is a not-found when the project is not in the initiative", async () => {
    const c = client({
      project: async (id: string) => ({
        id,
        name: "Loose",
        initiativeToProjects: async () => connection([]),
      }),
    });
    await expect(findProjectLink(c, UUID, PROJ)).rejects.toMatchObject({ code: "not_found" });
  });
});
