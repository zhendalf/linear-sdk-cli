import { describe, it, expect } from "vitest";
import { listStates, getStateDetail } from "../../src/services/state.js";

/** A team whose key matches the resolveTeam lookup, exposing a states() connection. */
function makeClient(nodes: any[]) {
  const team = {
    id: "team-uuid",
    key: "TES",
    name: "Test",
    states: async () => ({
      nodes,
      pageInfo: { hasNextPage: false },
      fetchNext: async () => ({ nodes, pageInfo: { hasNextPage: false } }),
    }),
  };
  return {
    teams: async () => ({ nodes: [team] }),
    team: async () => team,
  } as any;
}

describe("listStates", () => {
  it("maps the row columns and sorts by position ascending", async () => {
    const client = makeClient([
      { id: "c", name: "Done", type: "completed", position: 3, color: "#0f0" },
      { id: "a", name: "Backlog", type: "backlog", position: 1, color: "#888" },
      { id: "b", name: "In Progress", type: "started", position: 2, color: "#00f" },
    ]);
    const rows = await listStates(client, "TES", undefined, 50);
    expect(rows.map((r) => r.name)).toEqual(["Backlog", "In Progress", "Done"]);
    expect(rows[0]).toEqual({
      id: "a",
      name: "Backlog",
      type: "backlog",
      position: 1,
      color: "#888",
    });
  });

  it("falls back to the default team when none is given", async () => {
    const client = makeClient([
      { id: "a", name: "Todo", type: "unstarted", position: 1, color: "#888" },
    ]);
    const rows = await listStates(client, undefined, "TES", 50);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("unstarted");
  });
});

describe("getStateDetail", () => {
  it("maps a single state, unwrapping the team key and normalizing dates", async () => {
    const client = {
      workflowState: async () => ({
        id: "s1",
        name: "In Progress",
        type: "started",
        position: 2,
        color: "#00f",
        description: "Actively worked on",
        createdAt: new Date("2024-01-02T03:04:05.000Z"),
        updatedAt: new Date("2024-02-03T04:05:06.000Z"),
        team: Promise.resolve({ key: "TES" }),
      }),
    } as any;
    const d = await getStateDetail(client, "s1");
    expect(d).toEqual({
      id: "s1",
      name: "In Progress",
      type: "started",
      position: 2,
      color: "#00f",
      description: "Actively worked on",
      team: "TES",
      createdAt: "2024-01-02T03:04:05.000Z",
      updatedAt: "2024-02-03T04:05:06.000Z",
    });
  });

  it("tolerates a missing description and team", async () => {
    const client = {
      workflowState: async () => ({
        id: "s2",
        name: "Done",
        type: "completed",
        position: 4,
        color: "#0f0",
        description: null,
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        updatedAt: new Date("2024-01-01T00:00:00.000Z"),
        team: Promise.resolve(undefined),
      }),
    } as any;
    const d = await getStateDetail(client, "s2");
    expect(d.description).toBeNull();
    expect(d.team).toBeNull();
  });
});
