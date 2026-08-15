import { describe, it, expect } from "bun:test";
import {
  resolveStatus,
  resolvePriority,
  priorityLabel,
  createInitiative,
  updateInitiative,
} from "../../src/services/initiative.js";
import { connection } from "./_fakes.js";

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
        return Promise.resolve({ success: true, initiative: Promise.resolve({ id: "i1", name: input.name }) });
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
        return Promise.resolve({ success: true, initiative: Promise.resolve({ id: "i2", name: input.name }) });
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
        return Promise.resolve({ success: true, initiative: Promise.resolve({ id: "i1", name: "n" }) });
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
      updateInitiative: () => Promise.resolve({ success: true, initiative: Promise.resolve({ id: "i1" }) }),
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
        return Promise.resolve({ success: true, initiative: Promise.resolve({ id: "i1", name: "n" }) });
      },
    });
    await updateInitiative(client, "00000000-0000-4000-8000-000000000000", {
      status: "completed",
    });
    expect(captured).toEqual({ status: "Completed" });
  });
});
