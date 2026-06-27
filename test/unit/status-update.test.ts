import { describe, it, expect, vi, afterEach } from "bun:test";
import { CommanderError } from "commander";
import { createProgram } from "../../src/cli.js";
import { HEALTH_CHOICES, resolveUpdateBody } from "../../src/lib/status-update.js";
import { createProjectUpdate } from "../../src/services/project-update.js";
import { createInitiativeUpdate } from "../../src/services/initiative-update.js";

const UUID = "00000000-0000-4000-8000-000000000000";

afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// Shared helper
// ---------------------------------------------------------------------------
describe("status-update shared helper", () => {
  it("exposes the three health values Linear accepts", () => {
    expect([...HEALTH_CHOICES]).toEqual(["onTrack", "atRisk", "offTrack"]);
  });

  it("resolves a body from --body", () => {
    const ctx = { isTTY: false } as any;
    expect(resolveUpdateBody(ctx, { body: "shipped it" })).toBe("shipped it");
  });

  it("throws a usage error when no body resolves", () => {
    const ctx = { isTTY: false } as any;
    expect(() => resolveUpdateBody(ctx, {})).toThrowError(/needs a body/);
    try {
      resolveUpdateBody(ctx, {});
    } catch (err: any) {
      expect(err.code).toBe("usage");
    }
  });

  it("throws a usage error for a whitespace-only body", () => {
    const ctx = { isTTY: false } as any;
    expect(() => resolveUpdateBody(ctx, { body: "   \n  " })).toThrowError(/needs a body/);
  });
});

// ---------------------------------------------------------------------------
// Services (mocked client)
// ---------------------------------------------------------------------------
describe("createProjectUpdate (mocked client)", () => {
  it("builds an input with projectId, body and health", async () => {
    let captured: any;
    const client = {
      project: () => Promise.resolve({ id: UUID }),
      createProjectUpdate: (input: any) => {
        captured = input;
        return Promise.resolve({
          projectUpdate: Promise.resolve({
            id: "pu1",
            body: input.body,
            health: input.health,
            url: "https://linear.app/pu1",
            createdAt: new Date("2026-06-27T00:00:00Z"),
            user: Promise.resolve({ displayName: "Ada" }),
          }),
        });
      },
    } as any;

    const created = await createProjectUpdate(client, UUID, { body: "on track", health: "onTrack" });
    expect(captured).toEqual({ projectId: UUID, body: "on track", health: "onTrack" });
    expect(created).toMatchObject({ id: "pu1", body: "on track", health: "onTrack", user: "Ada" });
  });

  it("omits health when not provided", async () => {
    let captured: any;
    const client = {
      project: () => Promise.resolve({ id: UUID }),
      createProjectUpdate: (input: any) => {
        captured = input;
        return Promise.resolve({
          projectUpdate: Promise.resolve({
            id: "pu2",
            body: input.body,
            health: null,
            url: "u",
            createdAt: new Date(),
            user: Promise.resolve(null),
          }),
        });
      },
    } as any;
    await createProjectUpdate(client, UUID, { body: "hi" });
    expect(captured).toEqual({ projectId: UUID, body: "hi" });
  });

  it("throws when the payload returns no update", async () => {
    const client = {
      project: () => Promise.resolve({ id: UUID }),
      createProjectUpdate: () => Promise.resolve({ projectUpdate: Promise.resolve(null) }),
    } as any;
    await expect(createProjectUpdate(client, UUID, { body: "x" })).rejects.toMatchObject({
      code: "usage",
    });
  });
});

describe("createInitiativeUpdate (mocked client)", () => {
  it("builds an input with initiativeId, body and health", async () => {
    let captured: any;
    const client = {
      initiative: () => Promise.resolve({ id: "init-1" }),
      createInitiativeUpdate: (input: any) => {
        captured = input;
        return Promise.resolve({
          initiativeUpdate: Promise.resolve({
            id: "iu1",
            body: input.body,
            health: input.health,
            url: "https://linear.app/iu1",
            createdAt: new Date("2026-06-27T00:00:00Z"),
            user: Promise.resolve({ displayName: "Bo" }),
          }),
        });
      },
    } as any;

    const created = await createInitiativeUpdate(client, UUID, { body: "at risk", health: "atRisk" });
    expect(captured).toEqual({ initiativeId: "init-1", body: "at risk", health: "atRisk" });
    expect(created).toMatchObject({ id: "iu1", health: "atRisk", user: "Bo" });
  });

  it("throws when the payload returns no update", async () => {
    const client = {
      initiative: () => Promise.resolve({ id: "init-1" }),
      createInitiativeUpdate: () => Promise.resolve({ initiativeUpdate: Promise.resolve(null) }),
    } as any;
    await expect(createInitiativeUpdate(client, UUID, { body: "x" })).rejects.toMatchObject({
      code: "usage",
    });
  });
});

// ---------------------------------------------------------------------------
// CLI wiring
// ---------------------------------------------------------------------------
describe("project-update / initiative-update command wiring", () => {
  const find = (name: string) => createProgram().commands.find((c) => c.name() === name);

  it("registers both groups with their aliases", () => {
    const pu = find("project-update");
    const iu = find("initiative-update");
    expect(pu).toBeDefined();
    expect(iu).toBeDefined();
    expect(pu!.aliases()).toContain("pu");
    expect(iu!.aliases()).toContain("iu");
  });

  it("each group has create and list (with ls alias)", () => {
    for (const groupName of ["project-update", "initiative-update"]) {
      const group = find(groupName)!;
      const create = group.commands.find((c) => c.name() === "create");
      const list = group.commands.find((c) => c.name() === "list");
      expect(create).toBeDefined();
      expect(list).toBeDefined();
      expect(list!.aliases()).toContain("ls");
    }
  });

  it("create exposes --body / --body-file / --editor / --health", () => {
    const help = find("project-update")!.commands.find((c) => c.name() === "create")!.helpInformation();
    expect(help).toContain("--body");
    expect(help).toContain("--body-file");
    expect(help).toContain("--editor");
    expect(help).toContain("--health");
  });

  it("rejects an invalid --health choice", async () => {
    const program = createProgram();
    await expect(
      program.parseAsync(["node", "linear", "project-update", "create", UUID, "--body", "x", "--health", "great"]),
    ).rejects.toBeInstanceOf(CommanderError);
  });

  it("the removed `project updates` subcommand is gone", () => {
    const project = find("project")!;
    expect(project.commands.find((c) => c.name() === "updates")).toBeUndefined();
  });
});
