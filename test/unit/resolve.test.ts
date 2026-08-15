import { describe, it, expect } from "bun:test";
import {
  isUuid,
  resolveTeam,
  resolveUserId,
  resolveIssue,
  resolveCycleId,
  resolveStateId,
  resolveMilestoneId,
  firstStateOfType,
  STATE_TYPES,
} from "../../src/lib/resolve.js";
import { CliError } from "../../src/lib/errors.js";
import { connection } from "./_fakes.js";

const UUID = "01234567-89ab-cdef-0123-456789abcdef";

describe("isUuid", () => {
  it("recognizes uuids", () => {
    expect(isUuid(UUID)).toBe(true);
    expect(isUuid("TES-1")).toBe(false);
    expect(isUuid("backlog")).toBe(false);
  });
});

describe("resolveTeam", () => {
  const client = {
    teams: async () =>
      connection([
        { id: "t1", key: "TES", name: "Test" },
        { id: "t2", key: "ENG", name: "Engineering" },
      ]),
    team: async (id: string) => ({ id, key: "TES", name: "Test" }),
  } as any;

  it("resolves by key (case-insensitive)", async () => {
    expect((await resolveTeam(client, "tes", undefined)).id).toBe("t1");
  });
  it("uses the fallback key when no input", async () => {
    expect((await resolveTeam(client, undefined, "ENG")).id).toBe("t2");
  });
  it("passes a uuid straight through", async () => {
    expect((await resolveTeam(client, UUID, undefined)).id).toBe(UUID);
  });
  it("throws usage error when no team available", async () => {
    await expect(resolveTeam(client, undefined, undefined)).rejects.toBeInstanceOf(CliError);
  });
  it("throws not_found for unknown team", async () => {
    await expect(resolveTeam(client, "NOPE", undefined)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("resolveUserId", () => {
  const client = {
    viewer: Promise.resolve({ id: "viewer-id" }),
    users: async ({ filter }: any) => {
      if (filter.email) return connection([{ id: "u-email", email: "a@b.com" }]);
      return connection([{ id: "u-name", email: "named@b.com" }]);
    },
  } as any;

  it("resolves 'me' to the viewer", async () => {
    expect(await resolveUserId(client, "me")).toBe("viewer-id");
  });
  // All three sentinels must land on the same viewer lookup; `self` is the
  // reference CLI's spelling and must not fall through to a name search.
  it("resolves '@me' and 'self' to the same viewer id as 'me'", async () => {
    expect(await resolveUserId(client, "@me")).toBe("viewer-id");
    expect(await resolveUserId(client, "self")).toBe("viewer-id");
  });
  it("resolves by email", async () => {
    expect(await resolveUserId(client, "a@b.com")).toBe("u-email");
  });
  it("passes a uuid through", async () => {
    expect(await resolveUserId(client, UUID)).toBe(UUID);
  });
});

describe("resolveIssue", () => {
  it("parses an identifier into a team-key + number filter", async () => {
    let captured: any;
    const client = {
      issues: async (args: any) => {
        captured = args.filter;
        return connection([{ id: "iss-1", identifier: "TES-7" }]);
      },
    } as any;
    const issue = await resolveIssue(client, "tes-7");
    expect(issue.id).toBe("iss-1");
    expect(captured).toEqual({ team: { key: { eq: "TES" } }, number: { eq: 7 } });
  });

  it("rejects malformed ids", async () => {
    await expect(resolveIssue({} as any, "not-an-id!")).rejects.toBeInstanceOf(CliError);
  });
});

// The union of both CLIs' cycle vocabularies: number/uuid/`current` (ours) plus
// name/`active` (the reference's).
describe("resolveCycleId", () => {
  function makeClient(): { client: any; calls: any[] } {
    const calls: any[] = [];
    const cycles = [
      { id: "c1", number: 1, name: "Sprint One" },
      { id: "c2", number: 2, name: "Sprint Two" },
      { id: "c3", number: 3, name: null },
    ];
    const team = {
      activeCycle: Promise.resolve({ id: "c2", number: 2, name: "Sprint Two" }),
      cycles: async (args: any) => {
        calls.push(args);
        const num = args?.filter?.number?.eq;
        return connection(num === undefined ? cycles : cycles.filter((c) => c.number === num));
      },
    };
    return { client: { team: async () => team } as any, calls };
  }

  it("passes a uuid through without a lookup", async () => {
    const { client, calls } = makeClient();
    expect(await resolveCycleId(client, "t1", UUID)).toBe(UUID);
    expect(calls).toHaveLength(0);
  });

  it("resolves 'current' and 'active' to the same active cycle", async () => {
    const { client } = makeClient();
    expect(await resolveCycleId(client, "t1", "current")).toBe("c2");
    expect(await resolveCycleId(client, "t1", "active")).toBe("c2");
  });

  it("resolves a number through the server-side number filter (unchanged)", async () => {
    const { client, calls } = makeClient();
    expect(await resolveCycleId(client, "t1", "1")).toBe("c1");
    expect(calls[0].filter).toEqual({ number: { eq: 1 } });
  });

  it("resolves a cycle name, case-insensitively", async () => {
    const { client } = makeClient();
    expect(await resolveCycleId(client, "t1", "Sprint Two")).toBe("c2");
    expect(await resolveCycleId(client, "t1", "sprint one")).toBe("c1");
  });

  it("reports an unknown name as not_found, not a usage error", async () => {
    const { client } = makeClient();
    await expect(resolveCycleId(client, "t1", "Sprint Nine")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("skips unnamed cycles rather than matching them", async () => {
    const { client } = makeClient();
    await expect(resolveCycleId(client, "t1", "null")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("reports duplicate names as ambiguous", async () => {
    const client = {
      team: async () => ({
        activeCycle: Promise.resolve(null),
        cycles: async () =>
          connection([
            { id: "c1", number: 1, name: "Sprint" },
            { id: "c2", number: 2, name: "sprint" },
          ]),
      }),
    } as any;
    await expect(resolveCycleId(client, "t1", "Sprint")).rejects.toMatchObject({
      code: "ambiguous",
    });
  });

  it("still reports a missing cycle number as not_found", async () => {
    const { client } = makeClient();
    await expect(resolveCycleId(client, "t1", "99")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("STATE_TYPES", () => {
  it("includes the canonical workflow types", () => {
    expect(STATE_TYPES).toContain("started");
    expect(STATE_TYPES).toContain("backlog");
  });
});

/**
 * Resolution used to happen inside a fixed `first: 100`/`first: 250` window, so
 * on a large workspace a name that existed past the cap resolved to a false
 * `not_found` — and the ambiguity check only ever saw a prefix of the
 * candidates. Every one of these fails against that code: each target lives
 * past the page the old cap would have stopped at.
 */
describe("resolution past the first page", () => {
  /** `n` teams, paged as Linear pages them, with the wanted one near the end. */
  function bigTeamClient(n: number) {
    const teams = Array.from({ length: n }, (_, i) => ({
      id: `t${i}`,
      key: `T${i}`,
      name: `Team ${i}`,
    }));
    return { teams: async ({ first }: any) => connection(teams, first) } as any;
  }

  it("finds a team past the old 250 cap", async () => {
    const t = await resolveTeam(bigTeamClient(300), "T260", undefined);
    expect(t.id).toBe("t260");
  });

  it("finds a team by name past the old cap too", async () => {
    const t = await resolveTeam(bigTeamClient(300), "Team 299", undefined);
    expect(t.id).toBe("t299");
  });

  it("finds a workflow state past the old 100 cap", async () => {
    const states = Array.from({ length: 300 }, (_, i) => ({
      id: `s${i}`,
      name: `State ${i}`,
      type: i === 299 ? "started" : "unstarted",
      position: i,
    }));
    const client = {
      team: async () => ({ states: async ({ first }: any) => connection(states, first) }),
    } as any;
    expect(await resolveStateId(client, "t1", "State 150")).toBe("s150");
    // firstStateOfType reads the same list, so it was capped identically.
    expect(await firstStateOfType(client, "t1", "started")).toBe("s299");
  });

  it("finds a cycle by name past the old 250 cap", async () => {
    const cycles = Array.from({ length: 400 }, (_, i) => ({
      id: `c${i}`,
      number: i,
      name: `Cycle ${i}`,
    }));
    const client = {
      team: async () => ({
        activeCycle: Promise.resolve(null),
        cycles: async ({ first }: any) => connection(cycles, first),
      }),
    } as any;
    expect(await resolveCycleId(client, "t1", "Cycle 300")).toBe("c300");
  });

  it("finds a milestone past the old 100 cap", async () => {
    const ms = Array.from({ length: 150 }, (_, i) => ({ id: `m${i}`, name: `MS ${i}` }));
    const client = {
      project: async () => ({
        projectMilestones: async ({ first }: any) => connection(ms, first),
      }),
    } as any;
    expect(await resolveMilestoneId(client, "p1", "MS 120")).toBe("m120");
  });

  // Ambiguity is only meaningful over the whole candidate set: with a fixed
  // cap, a second match past the cap was silently invisible.
  it("sees a duplicate that lives past the first page", async () => {
    const teams = [
      { id: "t0", key: "A0", name: "Duplicate" },
      ...Array.from({ length: 300 }, (_, i) => ({
        id: `t${i + 1}`,
        key: `K${i}`,
        name: `Team ${i}`,
      })),
      { id: "tLast", key: "ZZ", name: "duplicate" },
    ];
    const client = { teams: async ({ first }: any) => connection(teams, first) } as any;
    await expect(resolveTeam(client, "Duplicate", undefined)).rejects.toMatchObject({
      code: "ambiguous",
    });
  });

  // The scan is bounded rather than unbounded, and says so instead of quietly
  // matching within a prefix.
  it("refuses honestly rather than truncating when the workspace is enormous", async () => {
    const teams = Array.from({ length: 2500 }, (_, i) => ({
      id: `t${i}`,
      key: `T${i}`,
      name: `Team ${i}`,
    }));
    const client = { teams: async ({ first }: any) => connection(teams, first) } as any;
    await expect(resolveTeam(client, "T2400", undefined)).rejects.toMatchObject({ code: "usage" });
    await expect(resolveTeam(client, "T2400", undefined)).rejects.toThrow(/pass the id instead/);
  });
});

/**
 * `resolveStateId` already listed the valid states on a miss; the other
 * resolvers said only that nothing matched. Each message now either lists the
 * candidates it already has in hand, or names the command that would show them
 * — neither costs an extra round-trip.
 */
describe("not-found messages point somewhere", () => {
  it("lists the teams when there are few enough to read", async () => {
    const client = {
      teams: async () =>
        connection([
          { id: "t1", key: "TES", name: "Test" },
          { id: "t2", key: "ENG", name: "Engineering" },
        ]),
    } as any;
    await expect(resolveTeam(client, "NOPE", undefined)).rejects.toThrow(
      /Available: TES, ENG\./,
    );
  });

  it("points at the list command instead of dumping hundreds of teams", async () => {
    const teams = Array.from({ length: 300 }, (_, i) => ({
      id: `t${i}`,
      key: `T${i}`,
      name: `Team ${i}`,
    }));
    const client = { teams: async ({ first }: any) => connection(teams, first) } as any;
    const err = await resolveTeam(client, "NOPE", undefined).catch((e) => e);
    expect(err.message).toMatch(/linear team list/);
    expect(err.message).not.toMatch(/T250/);
  });

  it("lists the milestones in the project", async () => {
    const client = {
      project: async () => ({
        projectMilestones: async () => connection([{ id: "m1", name: "Beta" }]),
      }),
    } as any;
    await expect(resolveMilestoneId(client, "p1", "Nope")).rejects.toThrow(/Available: Beta\./);
  });

  it("lists the named cycles in the team", async () => {
    const client = {
      team: async () => ({
        activeCycle: Promise.resolve(null),
        cycles: async () =>
          connection([
            { id: "c1", number: 1, name: "Sprint One" },
            { id: "c2", number: 2, name: null },
          ]),
      }),
    } as any;
    // The unnamed cycle is skipped rather than listed as an empty option.
    await expect(resolveCycleId(client, "t1", "Nope")).rejects.toThrow(/Available: Sprint One\./);
  });

  it("names the state types available when no state of a type exists", async () => {
    const client = {
      team: async () => ({
        states: async () =>
          connection([{ id: "s1", name: "Todo", type: "unstarted", position: 0 }]),
      }),
    } as any;
    await expect(firstStateOfType(client, "t1", "started")).rejects.toThrow(
      /Available: unstarted\./,
    );
  });

  it("points a user miss at the user list", async () => {
    const client = { users: async () => connection([]) } as any;
    await expect(resolveUserId(client, "nobody")).rejects.toThrow(/linear user list/);
  });
});
