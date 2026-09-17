import { describe, expect, it } from "bun:test";
import {
  archiveProjectStatus,
  createProjectStatus,
  getProjectStatusDetail,
  listProjectStatuses,
  resolveProjectStatusId,
  unarchiveProjectStatus,
  updateProjectStatus,
} from "../../src/services/project-status.js";
import { connection, failedPayload, okPayload, payload } from "./_fakes.js";

const ID = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const date = new Date("2026-01-01T00:00:00.000Z");

function status(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    name: "In progress",
    description: "Work is underway",
    color: "#5E6AD2",
    position: 2,
    type: "started",
    indefinite: false,
    archivedAt: null,
    createdAt: date,
    updatedAt: date,
    ...overrides,
  };
}

describe("project status list and resolution", () => {
  it("paginates, maps, sorts, and requests archived statuses only when asked", async () => {
    const seen: any[] = [];
    const client: any = {
      projectStatuses: async (vars: any) => {
        seen.push(vars);
        return connection([
          status({ id: OTHER, name: "Done", type: "completed", position: 1 }),
          status({ name: "Doing", position: 1 }),
        ]);
      },
    };
    const rows = await listProjectStatuses(client, Infinity, true);
    expect(seen).toEqual([{ first: 250, includeArchived: true }]);
    expect(rows.map((row) => row.name)).toEqual(["Doing", "Done"]);
    expect(rows[0]?.archivedAt).toBeNull();
  });

  it("resolves an exact name and reports duplicate names with ids", async () => {
    const client: any = {
      projectStatuses: async () =>
        connection([status(), status({ id: OTHER, name: "In progress" })]),
    };
    await expect(resolveProjectStatusId(client, "In progress")).rejects.toMatchObject({
      code: "ambiguous",
      message: expect.stringContaining(OTHER),
    });
  });

  it("falls back to type only for project --state compatibility", async () => {
    const client: any = { projectStatuses: async () => connection([status()]) };
    expect(await resolveProjectStatusId(client, "started", { allowType: true })).toBe(ID);
    await expect(resolveProjectStatusId(client, "started")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("includes archived definitions for view-by-name", async () => {
    const seen: any[] = [];
    const model = status({ archivedAt: date });
    const client: any = {
      projectStatuses: async (vars: any) => (seen.push(vars), connection([model])),
      projectStatus: async () => model,
    };
    expect((await getProjectStatusDetail(client, "In progress")).archivedAt).toBe(
      date.toISOString(),
    );
    expect(seen[0].includeArchived).toBe(true);
  });
});

describe("project status mutations", () => {
  it("creates with every supported field and checks mutation success", async () => {
    let input: any;
    const model = status({ indefinite: true });
    const client: any = {
      createProjectStatus: async (value: any) => ((input = value), payload("status", model)),
    };
    const created = await createProjectStatus(client, {
      name: model.name,
      description: model.description,
      color: model.color,
      position: model.position,
      type: model.type,
      indefinite: true,
    });
    expect(created.id).toBe(ID);
    expect(input).toEqual({
      name: "In progress",
      description: "Work is underway",
      color: "#5E6AD2",
      position: 2,
      type: "started",
      indefinite: true,
    });
  });

  it("validates all input before calling a mutation", async () => {
    let called = false;
    const client: any = { createProjectStatus: async () => ((called = true), okPayload()) };
    await expect(
      createProjectStatus(client, {
        name: "Bad",
        color: "blue",
        position: -1,
        type: "waiting",
      }),
    ).rejects.toMatchObject({ code: "usage" });
    expect(called).toBe(false);
  });

  it("updates false-valued indefinite and rejects an empty update", async () => {
    let input: any;
    const model = status();
    const client: any = {
      updateProjectStatus: async (_id: string, value: any) => (
        (input = value),
        payload("status", model)
      ),
    };
    await updateProjectStatus(client, ID, { indefinite: false });
    expect(input).toEqual({ indefinite: false });
    await expect(updateProjectStatus(client, ID, {})).rejects.toMatchObject({ code: "usage" });
  });

  it("requires successful archive and unarchive payloads", async () => {
    const model = status({ archivedAt: date });
    const client: any = {
      projectStatus: async () => model,
      archiveProjectStatus: async () => failedPayload(),
      unarchiveProjectStatus: async () => okPayload(),
    };
    await expect(archiveProjectStatus(client, ID)).rejects.toMatchObject({ code: "api" });
    expect((await unarchiveProjectStatus(client, ID)).id).toBe(ID);
  });

  it("preserves Linear archive-constraint and permission errors", async () => {
    const constraint = new Error(
      "Project status has active projects or is the last status of its type",
    );
    class ForbiddenError extends Error {}
    const forbidden = new ForbiddenError("You do not have permission to edit project statuses");
    const model = status();
    const base = { projectStatus: async () => model };
    await expect(
      archiveProjectStatus(
        {
          ...base,
          archiveProjectStatus: async () => {
            throw constraint;
          },
        } as any,
        ID,
      ),
    ).rejects.toMatchObject({
      message: constraint.message,
      code: "runtime",
    });
    await expect(
      updateProjectStatus(
        {
          updateProjectStatus: async () => {
            throw forbidden;
          },
        } as any,
        ID,
        { name: "Next" },
      ),
    ).rejects.toMatchObject({
      message: forbidden.message,
      code: "forbidden",
    });
  });
});
