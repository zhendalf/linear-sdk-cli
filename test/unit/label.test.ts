import { describe, it, expect } from "bun:test";
import { listLabels, createLabel, updateLabel, deleteLabel } from "../../src/services/label.js";
import { CliError } from "../../src/lib/errors.js";
import { connection } from "./_fakes.js";

// A faithful SDK connection (see _fakes.ts): fetchNext() mutates and returns
// `this`, which is what the real one does and what an ad-hoc literal did not.
const conn = <T,>(nodes: T[]) => connection(nodes) as any;

const TEAMS = [
  { id: "t1", key: "TES", name: "Test" },
  { id: "t2", key: "ENG", name: "Engineering" },
];

/** Build a client whose raw GraphQL list call records the variables it received. */
function listClient(nodes: any[]) {
  const calls: any[] = [];
  const client = {
    teams: async () => conn(TEAMS),
    team: async (id: string) => TEAMS.find((t) => t.id === id),
    client: {
      rawRequest: async (_q: string, vars: any) => {
        calls.push(vars);
        return { data: { issueLabels: { nodes, pageInfo: { hasNextPage: false } } } };
      },
    },
  } as any;
  return { client, calls };
}

const NODES = [
  { id: "l1", name: "bug", color: "#EB5757", isGroup: false, team: { key: "TES", name: "Test" }, parent: null },
  { id: "l2", name: "ui", color: "#5E6AD2", isGroup: false, team: null, parent: null },
];

describe("listLabels", () => {
  it("returns all labels (no team filter) when no team is in scope", async () => {
    const { client, calls } = listClient(NODES);
    const rows = await listLabels(client, undefined, 50, undefined);
    expect(calls[0].filter).toBeUndefined();
    expect(rows.map((r) => r.name)).toEqual(["bug", "ui"]);
    expect(rows[1]).toMatchObject({ team: null, isGroup: false });
  });

  // TES-617: a team scope used to filter on `team.key` alone, which silently
  // dropped every workspace-level (team-less) label — the ones an issue in that
  // team can carry just as well, and the ones `resolveLabelIds` accepts. The
  // filter on the wire must OR the team key with `team: { null: true }`.
  it("scopes to the team's labels PLUS workspace-level labels", async () => {
    const { client, calls } = listClient(NODES);
    const rows = await listLabels(client, "tes", 50, undefined);
    expect(calls[0].filter).toEqual({
      or: [{ team: { key: { eq: "TES" } } }, { team: { null: true } }],
    });
    // The workspace label survives the scope.
    expect(rows.map((r) => r.name)).toEqual(["bug", "ui"]);
  });

  it("falls back to the default team when none is passed", async () => {
    const { client, calls } = listClient(NODES);
    await listLabels(client, undefined, 50, "ENG");
    expect(calls[0].filter).toEqual({
      or: [{ team: { key: { eq: "ENG" } } }, { team: { null: true } }],
    });
  });

  it("--all-teams ignores both the argument and the default team", async () => {
    const { client, calls } = listClient(NODES);
    await listLabels(client, "tes", 50, "ENG", { allTeams: true });
    expect(calls[0].filter).toBeUndefined();
  });
});

describe("createLabel", () => {
  it("creates a workspace-level label (no teamId) when --team is omitted", async () => {
    let captured: any;
    const client = {
      createIssueLabel: async (input: any) => {
        captured = input;
        return { success: true, issueLabel: Promise.resolve({ id: "l9", name: "x", color: "#000" }) };
      },
    } as any;
    const created = await createLabel(client, { name: "x", color: "#000" }, undefined);
    expect(captured).toEqual({ name: "x", color: "#000" });
    expect("teamId" in captured).toBe(false);
    expect(created).toMatchObject({ id: "l9", name: "x" });
  });

  it("resolves --team to a teamId", async () => {
    let captured: any;
    const client = {
      teams: async () => conn(TEAMS),
      team: async (id: string) => TEAMS.find((t) => t.id === id),
      createIssueLabel: async (input: any) => {
        captured = input;
        return { success: true, issueLabel: Promise.resolve({ id: "l9", name: "x", color: "#000" }) };
      },
    } as any;
    await createLabel(client, { name: "x", team: "TES" }, undefined);
    expect(captured.teamId).toBe("t1");
  });

  it("throws when the payload has no label", async () => {
    const client = {
      createIssueLabel: async () => ({ success: false, issueLabel: Promise.resolve(null) }),
    } as any;
    await expect(createLabel(client, { name: "x" }, undefined)).rejects.toBeInstanceOf(CliError);
  });
});

describe("updateLabel", () => {
  const uuid = "01234567-89ab-cdef-0123-456789abcdef";

  it("throws a usage error when no fields are provided", async () => {
    const client = {} as any;
    await expect(updateLabel(client, uuid, {})).rejects.toMatchObject({ code: "usage" });
  });

  it("forwards only the provided fields and unwraps the payload", async () => {
    let capturedId: string | undefined;
    let captured: any;
    const client = {
      updateIssueLabel: async (id: string, input: any) => {
        capturedId = id;
        captured = input;
        return { success: true, issueLabel: Promise.resolve({ id: uuid, name: "renamed", color: "#FFF" }) };
      },
    } as any;
    const updated = await updateLabel(client, uuid, { name: "renamed", color: "#FFF" });
    expect(capturedId).toBe(uuid);
    expect(captured).toEqual({ name: "renamed", color: "#FFF" });
    expect(updated).toMatchObject({ name: "renamed" });
  });

  it("resolves a label name to its id before updating", async () => {
    let capturedId: string | undefined;
    const client = {
      issueLabels: async () => conn([{ id: "l1", name: "bug" }]),
      updateIssueLabel: async (id: string, _input: any) => {
        capturedId = id;
        return { success: true, issueLabel: Promise.resolve({ id, name: "bug", color: "#000" }) };
      },
    } as any;
    await updateLabel(client, "bug", { color: "#000" });
    expect(capturedId).toBe("l1");
  });

  it("throws ambiguous when a name matches multiple labels", async () => {
    const client = {
      issueLabels: async () => conn([{ id: "l1", name: "dup" }, { id: "l2", name: "dup" }]),
    } as any;
    await expect(updateLabel(client, "dup", { color: "#000" })).rejects.toMatchObject({
      code: "ambiguous",
    });
  });
});

describe("deleteLabel", () => {
  it("fetches the label, deletes by id, and returns the label", async () => {
    const uuid = "01234567-89ab-cdef-0123-456789abcdef";
    let deletedId: string | undefined;
    const client = {
      issueLabel: async (id: string) => ({ id, name: "bug", color: "#EB5757" }),
      deleteIssueLabel: async (id: string) => {
        deletedId = id;
        return { success: true };
      },
    } as any;
    const label = await deleteLabel(client, uuid);
    expect(deletedId).toBe(uuid);
    expect(label).toMatchObject({ id: uuid, name: "bug" });
  });
});
