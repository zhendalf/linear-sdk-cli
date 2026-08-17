import { describe, it, expect } from "bun:test";
import { listStates, getStateDetail } from "../../src/services/state.js";
import { connection } from "./_fakes.js";

const UUID = "01234567-89ab-cdef-0123-456789abcdef";

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
    teams: async () => connection([team]),
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
    const d = await getStateDetail(client, UUID);
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
    const d = await getStateDetail(client, UUID);
    expect(d.description).toBeNull();
    expect(d.team).toBeNull();
  });

  /**
   * TES-634: `state view Backlog` used to send the name to `workflowState(id:)`
   * and get "Could not find referenced WorkflowState" back — the by-name
   * resolver existed (`issue create --state` uses it) but was not wired.
   */
  describe("by name or type, within a team", () => {
    const states = [
      { id: "st-backlog", name: "Backlog", type: "backlog", position: 0, color: "#888" },
      { id: "st-progress", name: "In Progress", type: "started", position: 2, color: "#00f" },
    ];
    function client(seen: string[] = []) {
      const team = {
        id: "team-uuid",
        key: "TES",
        name: "Test",
        states: async () => connection(states),
      };
      return {
        teams: async () => connection([team]),
        team: async () => team,
        workflowState: async (id: string) => {
          seen.push(id);
          const s = states.find((x) => x.id === id)!;
          return {
            ...s,
            description: null,
            createdAt: new Date("2024-01-01T00:00:00.000Z"),
            updatedAt: new Date("2024-01-01T00:00:00.000Z"),
            team: Promise.resolve({ key: "TES" }),
          };
        },
      } as any;
    }

    it("resolves a state name against the team, then fetches it by the resolved id", async () => {
      const seen: string[] = [];
      const d = await getStateDetail(client(seen), "backlog", "TES");
      expect(d.id).toBe("st-backlog");
      expect(seen).toEqual(["st-backlog"]);
    });

    it("resolves a state *type* the same way", async () => {
      const d = await getStateDetail(client(), "started", "TES");
      expect(d.name).toBe("In Progress");
    });

    it("a UUID goes straight to the id lookup — no team needed, none consulted", async () => {
      const seen: string[] = [];
      const c = client(seen);
      c.teams = async () => {
        throw new Error("must not resolve a team for a UUID");
      };
      c.workflowState = async (id: string) => {
        seen.push(id);
        return {
          ...states[0]!,
          id,
          description: null,
          createdAt: new Date(0),
          updatedAt: new Date(0),
          team: Promise.resolve(null),
        };
      };
      await getStateDetail(c, UUID);
      expect(seen).toEqual([UUID]);
    });

    it("a name with no team to scope it is a usage error that says what to pass", async () => {
      await expect(getStateDetail(client(), "Backlog")).rejects.toMatchObject({
        code: "usage",
        message: expect.stringContaining("pass --team <KEY>"),
      });
    });

    it("an unknown name is not_found, listing the team's states", async () => {
      await expect(getStateDetail(client(), "Nope", "TES")).rejects.toMatchObject({
        code: "not_found",
        message: expect.stringContaining("Available: Backlog, In Progress"),
      });
    });
  });
});
