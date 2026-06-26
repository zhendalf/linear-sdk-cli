import { describe, it, expect } from "bun:test";
import {
  toRow,
  createMilestone,
  updateMilestone,
} from "../../src/services/milestone.js";
import { CliError } from "../../src/lib/errors.js";

const UUID = "01234567-89ab-cdef-0123-456789abcdef";

describe("toRow", () => {
  it("projects a milestone node to a row with sane defaults", () => {
    expect(
      toRow({ id: "m1", name: "Beta", targetDate: "2026-01-01", progress: 0.5, status: "next" }),
    ).toEqual({
      id: "m1",
      name: "Beta",
      targetDate: "2026-01-01",
      progress: 0.5,
      status: "next",
      description: null,
    });
  });

  it("nulls a missing target date and defaults progress to 0", () => {
    const row = toRow({ id: "m2", name: "Alpha" });
    expect(row.targetDate).toBeNull();
    expect(row.progress).toBe(0);
    expect(row.status).toBe("");
  });
});

describe("createMilestone", () => {
  it("builds the create input with projectId, name, description and targetDate", async () => {
    let captured: any;
    const client = {
      // resolveProjectId passes a uuid straight through (no SDK call).
      createProjectMilestone: async (input: any) => {
        captured = input;
        return { projectMilestone: Promise.resolve({ id: "new-m", name: input.name }) };
      },
    } as any;
    const created = await createMilestone(client, UUID, {
      name: "Phase 1",
      description: "do the thing",
      targetDate: "2026-03-01",
    });
    expect(captured).toEqual({
      projectId: UUID,
      name: "Phase 1",
      description: "do the thing",
      targetDate: "2026-03-01",
    });
    expect(created.id).toBe("new-m");
  });

  it("omits optional fields when not provided", async () => {
    let captured: any;
    const client = {
      createProjectMilestone: async (input: any) => {
        captured = input;
        return { projectMilestone: Promise.resolve({ id: "m", name: input.name }) };
      },
    } as any;
    await createMilestone(client, UUID, { name: "Bare" });
    expect(captured).toEqual({ projectId: UUID, name: "Bare" });
  });

  it("throws when the payload returns no milestone", async () => {
    const client = {
      createProjectMilestone: async () => ({ projectMilestone: Promise.resolve(null) }),
    } as any;
    await expect(createMilestone(client, UUID, { name: "X" })).rejects.toMatchObject({
      code: "usage",
    });
  });
});

describe("updateMilestone", () => {
  it("builds an update input from provided fields only", async () => {
    let captured: any;
    const client = {
      projectMilestone: async (id: string) => ({ id }),
      updateProjectMilestone: async (_id: string, input: any) => {
        captured = input;
        return { projectMilestone: Promise.resolve({ id: _id, name: input.name }) };
      },
    } as any;
    await updateMilestone(client, "m1", { name: "Renamed", targetDate: "2026-04-01" });
    expect(captured).toEqual({ name: "Renamed", targetDate: "2026-04-01" });
  });

  it("throws a usage error when there is nothing to update", async () => {
    const client = {
      projectMilestone: async (id: string) => ({ id }),
    } as any;
    await expect(updateMilestone(client, "m1", {})).rejects.toBeInstanceOf(CliError);
    await expect(updateMilestone(client, "m1", {})).rejects.toMatchObject({ code: "usage" });
  });
});
