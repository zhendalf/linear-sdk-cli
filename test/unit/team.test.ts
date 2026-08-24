import { describe, it, expect } from "bun:test";
import {
  listTeams,
  listMembers,
  listStates,
  updateTeam,
  createTeam,
  planDeleteTeam,
  moveTeamIssues,
  deleteTeam,
} from "../../src/services/team.js";
import { CliError } from "../../src/lib/errors.js";
import { connection, okPayload, failedPayload, payload } from "./_fakes.js";

// A faithful SDK connection (see _fakes.ts): fetchNext() mutates and returns
// `this`, which is what the real one does and what an ad-hoc literal did not.
const conn = <T>(nodes: T[]) => connection(nodes) as any;

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

describe("listMembers", () => {
  /** Capture the variables `team.members()` is called with. */
  function memberClient(seen: any[], nodes: any[] = []) {
    return {
      teams: async () => conn(TEAMS),
      team: async () => ({
        ...teamModel(),
        members: async (vars: any) => {
          seen.push(vars);
          return conn(nodes);
        },
      }),
    } as any;
  }

  // Linear defaults includeDisabled to false, so omitting it hides deactivated
  // users entirely and makes the `active` column constantly true.
  it("excludes deactivated members by default and opts in explicitly", async () => {
    const seen: any[] = [];
    await listMembers(memberClient(seen), "TES", undefined, 50);
    await listMembers(memberClient(seen), "TES", undefined, 50, true);
    expect(seen.map((v) => v.includeDisabled)).toEqual([false, true]);
  });

  it("requests a page no larger than 100 and maps rows", async () => {
    const seen: any[] = [];
    const client = memberClient(seen, [
      {
        id: "u1",
        displayName: "ada",
        name: "Ada Lovelace",
        email: "ada@example.com",
        active: false,
      },
    ]);
    const rows = await listMembers(client, "TES", undefined, Infinity, true);
    expect(seen[0].first).toBe(250);
    expect(rows).toEqual([
      {
        id: "u1",
        displayName: "ada",
        name: "Ada Lovelace",
        email: "ada@example.com",
        active: false,
      },
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
  // TES-642: `--private`. Sent only when asked for; Linear's default is public,
  // and a plan without private teams refuses it (feature_not_accessible).
  it("sends private: true only when asked", async () => {
    const inputs: any[] = [];
    const client = {
      createTeam: async (input: any) => (
        inputs.push(input),
        payload("team", { id: "t", key: "K", name: "N" })
      ),
    } as any;
    await createTeam(client, { name: "N" });
    await createTeam(client, { name: "N", private: false });
    await createTeam(client, { name: "N", private: true });
    expect(inputs).toEqual([{ name: "N" }, { name: "N" }, { name: "N", private: true }]);
  });

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

/**
 * TES-644: `team delete <key> [--move-issues <team>]`. The plan is resolved in
 * full before the confirmation so the prompt can name the team, its issue count
 * and the destination; the move goes in batches; the delete asserts success.
 */
describe("team delete", () => {
  const OTHER = { id: "t2", key: "ENG", name: "Engineering" };
  function client(overrides: any = {}) {
    return {
      teams: async () => conn(TEAMS),
      team: async (id: string) => ({
        ...teamModel(),
        id,
        key: id === "t1" ? "TES" : "ENG",
        issueCount: id === "t1" ? 3 : 0,
        issues: async () => conn([{ id: "i1" }, { id: "i2" }, { id: "i3" }]),
      }),
      ...overrides,
    } as any;
  }

  it("plans against an explicit key only — never the configured default", async () => {
    const plan = await planDeleteTeam(client(), "tes", undefined);
    expect(plan.team).toEqual({ id: "t1", key: "TES", name: "Test" });
    expect(plan.issueCount).toBe(3);
    expect(plan.moveTo).toBeUndefined();
    await expect(planDeleteTeam(client(), undefined as any, undefined)).rejects.toMatchObject({
      code: "usage",
    });
  });

  it("resolves --move-issues and refuses the team itself", async () => {
    const plan = await planDeleteTeam(client(), "TES", "eng");
    expect(plan.moveTo).toEqual(OTHER);
    await expect(planDeleteTeam(client(), "TES", "tes")).rejects.toMatchObject({ code: "usage" });
  });

  it("moves every live issue in batches of 50 and asserts each payload", async () => {
    const seen: Array<{ ids: string[]; input: any }> = [];
    const ids = Array.from({ length: 120 }, (_, i) => ({ id: `i${i}` }));
    const c = client({
      team: async () => ({ ...teamModel(), issues: async () => conn(ids) }),
      updateIssueBatch: async (batchIds: string[], input: any) => {
        seen.push({ ids: batchIds, input });
        return okPayload();
      },
    });
    const moved = await moveTeamIssues(c, { id: "t1", key: "TES", name: "Test" }, OTHER);
    expect(moved).toBe(120);
    expect(seen.map((s) => s.ids.length)).toEqual([50, 50, 20]);
    expect(seen.every((s) => s.input.teamId === "t2")).toBe(true);
  });

  it("stops at the first batch the API refuses", async () => {
    let calls = 0;
    const c = client({
      updateIssueBatch: async () => (calls++, failedPayload()),
    });
    await expect(
      moveTeamIssues(c, { id: "t1", key: "TES", name: "Test" }, OTHER),
    ).rejects.toMatchObject({ code: "api" });
    expect(calls).toBe(1);
  });

  it("deleteTeam asserts success and reports a refusal as an api error", async () => {
    const seen: string[] = [];
    await deleteTeam(client({ deleteTeam: async (id: string) => (seen.push(id), okPayload()) }), {
      id: "t1",
      key: "TES",
      name: "Test",
    });
    expect(seen).toEqual(["t1"]);
    await expect(
      deleteTeam(client({ deleteTeam: async () => failedPayload() }), {
        id: "t1",
        key: "TES",
        name: "Test",
      }),
    ).rejects.toMatchObject({ code: "api" });
  });
});
