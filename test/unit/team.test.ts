import { describe, it, expect } from "bun:test";
import { listTeams, listStates, updateTeam, createTeam } from "../../src/services/team.js";
import { CliError } from "../../src/lib/errors.js";

/** A connection stub matching the shape `collect()` expects. */
function conn(nodes: any[]) {
  return { nodes, pageInfo: { hasNextPage: false }, fetchNext: async () => conn(nodes) };
}

const TEAMS = [
  { id: "t1", key: "TES", name: "Test" },
  { id: "t2", key: "ENG", name: "Engineering" },
];

function teamModel(states: any[] = []) {
  return {
    id: "t1",
    key: "TES",
    name: "Test",
    members: async () => conn([]),
    states: async () => conn(states),
    labels: async () => conn([]),
    cycles: async () => conn([]),
  };
}

describe("listTeams", () => {
  it("maps teams to key/name/id rows", async () => {
    const client = { teams: async () => conn(TEAMS) } as any;
    const rows = await listTeams(client, 50);
    expect(rows).toEqual([
      { id: "t1", key: "TES", name: "Test" },
      { id: "t2", key: "ENG", name: "Engineering" },
    ]);
  });
});

describe("listStates", () => {
  it("sorts workflow states by position ascending", async () => {
    const states = [
      { id: "s3", name: "Done", type: "completed", color: "#000", position: 3 },
      { id: "s1", name: "Todo", type: "unstarted", color: "#111", position: 1 },
      { id: "s2", name: "Doing", type: "started", color: "#222", position: 2 },
    ];
    const client = {
      teams: async () => conn(TEAMS),
      team: async () => teamModel(states),
    } as any;
    const rows = await listStates(client, "TES", undefined, 50);
    expect(rows.map((r) => r.name)).toEqual(["Todo", "Doing", "Done"]);
    expect(rows[0]).toMatchObject({ type: "unstarted", position: 1 });
  });
});

describe("updateTeam", () => {
  const base = {
    teams: async () => conn(TEAMS),
    team: async () => teamModel(),
  };

  it("throws a usage error when no fields are provided", async () => {
    const client = { ...base } as any;
    await expect(updateTeam(client, "TES", undefined, {})).rejects.toMatchObject({ code: "usage" });
  });

  it("forwards only the provided fields and unwraps the payload", async () => {
    let captured: any;
    const client = {
      ...base,
      updateTeam: async (_id: string, input: any) => {
        captured = input;
        return { success: true, team: Promise.resolve({ id: "t1", key: "TST", name: "Renamed" }) };
      },
    } as any;
    const updated = await updateTeam(client, "TES", undefined, { name: "Renamed", key: "TST" });
    expect(captured).toEqual({ name: "Renamed", key: "TST" });
    expect(updated).toMatchObject({ key: "TST", name: "Renamed" });
  });
});

describe("createTeam", () => {
  it("requires only name and unwraps the created team", async () => {
    let captured: any;
    const client = {
      createTeam: async (input: any) => {
        captured = input;
        return { success: true, team: Promise.resolve({ id: "t9", key: "NEW", name: "New Team" }) };
      },
    } as any;
    const created = await createTeam(client, { name: "New Team" });
    expect(captured).toEqual({ name: "New Team" });
    expect(created).toMatchObject({ key: "NEW", name: "New Team" });
  });

  it("throws when the payload has no team", async () => {
    const client = {
      createTeam: async () => ({ success: false, team: Promise.resolve(null) }),
    } as any;
    await expect(createTeam(client, { name: "x" })).rejects.toBeInstanceOf(CliError);
  });
});
