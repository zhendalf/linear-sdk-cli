import { describe, it, expect } from "bun:test";
import {
  resolveStatus,
  createInitiative,
  updateInitiative,
} from "../../src/services/initiative.js";

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

describe("createInitiative (mocked client)", () => {
  it("builds an input with name, description, owner id and status", async () => {
    let captured: any;
    const client = {
      users: () => Promise.resolve({ nodes: [{ id: "owner-id", email: "a@b.c" }] }),
      createInitiative: (input: any) => {
        captured = input;
        return Promise.resolve({ initiative: Promise.resolve({ id: "i1", name: input.name }) });
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
        return Promise.resolve({ initiative: Promise.resolve({ id: "i2", name: input.name }) });
      },
    } as any;

    await createInitiative(client, { name: "Bare" });
    expect(captured).toEqual({ name: "Bare" });
  });

  it("throws when the payload returns no initiative", async () => {
    const client = {
      createInitiative: () => Promise.resolve({ initiative: Promise.resolve(null) }),
    } as any;
    await expect(createInitiative(client, { name: "x" })).rejects.toMatchObject({
      code: "usage",
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

  it("normalizes status on update", async () => {
    let captured: any;
    const client = idClient({
      updateInitiative: (_id: string, input: any) => {
        captured = input;
        return Promise.resolve({ initiative: Promise.resolve({ id: "i1", name: "n" }) });
      },
    });
    await updateInitiative(client, "00000000-0000-4000-8000-000000000000", {
      status: "completed",
    });
    expect(captured).toEqual({ status: "Completed" });
  });
});
