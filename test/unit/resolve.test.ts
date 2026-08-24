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
  normalizeIssueReference,
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

describe("normalizeIssueReference", () => {
  it("expands a bare number with the configured team and canonicalizes leading zeros", () => {
    expect(normalizeIssueReference("0042", "tes")).toBe("TES-42");
  });

  it("leaves identifiers and UUIDs untouched", () => {
    expect(normalizeIssueReference("eng-7", "TES")).toBe("eng-7");
    expect(normalizeIssueReference(UUID, "TES")).toBe(UUID);
  });

  it("refuses a bare number when no team key can disambiguate it", () => {
    expect(() => normalizeIssueReference("42")).toThrow(/needs a default team/);
    expect(() => normalizeIssueReference("42", UUID)).toThrow(/configure a team key/);
  });
});

describe("resolveStateId name precedence", () => {
  it("prefers an exact state name before treating the same token as a type alias", async () => {
    const client = {
      team: async () => ({
        states: async () =>
          connection([
            { id: "named", name: "Started", type: "unstarted", position: 0 },
            { id: "typed", name: "In Progress", type: "started", position: 1 },
          ]),
      }),
    } as any;
    expect(await resolveStateId(client, "team-1", "started")).toBe("named");
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
    await expect(resolveTeam(client, "NOPE", undefined)).rejects.toMatchObject({
      code: "not_found",
    });
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

/**
 * TES-621: `Number.parseInt` decided what was a number, so `3.9`/`3abc` resolved
 * to cycle #3 (and `issue update --cycle 3.9` moved the issue there), while a
 * cycle *named* with a leading digit was unreachable by name — `2024 Q1` parsed
 * as #2024 first. Only a whole-token integer is a number now.
 */
describe("resolveCycleId — strict number token", () => {
  function makeClient() {
    const calls: any[] = [];
    const cycles = [
      { id: "c3", number: 3, name: null },
      { id: "c-q1", number: 7, name: "2024 Q1" },
    ];
    const team = {
      activeCycle: Promise.resolve(null),
      cycles: async (args: any) => {
        calls.push(args);
        const num = args?.filter?.number?.eq;
        return connection(num === undefined ? cycles : cycles.filter((c) => c.number === num));
      },
    };
    return { client: { team: async () => team } as any, calls };
  }

  it("does not read '3.9' or '3abc' as cycle #3", async () => {
    const { client, calls } = makeClient();
    await expect(resolveCycleId(client, "t1", "3.9")).rejects.toMatchObject({ code: "not_found" });
    await expect(resolveCycleId(client, "t1", "3abc")).rejects.toMatchObject({ code: "not_found" });
    // Neither ever asked the server for number 3.
    expect(calls.some((c) => c?.filter?.number?.eq === 3)).toBe(false);
  });

  it("reaches a cycle named with a leading digit by name", async () => {
    const { client, calls } = makeClient();
    expect(await resolveCycleId(client, "t1", "2024 Q1")).toBe("c-q1");
    expect(calls.some((c) => c?.filter?.number?.eq === 2024)).toBe(false);
  });

  it("still resolves a whole-token integer through the number filter", async () => {
    const { client, calls } = makeClient();
    expect(await resolveCycleId(client, "t1", "3")).toBe("c3");
    expect(calls[0].filter).toEqual({ number: { eq: 3 } });
  });
});

/**
 * TES-611: the reference CLI's 2.2 relative references. `now` joins
 * `current`/`active`; `next`/`previous` ride Linear's own `isNext`/`isPrevious`
 * flags (one filtered request, not a scan); `+N`/`-N` are offsets from the
 * active cycle's number.
 */
describe("resolveCycleId — relative references", () => {
  function makeClient(active: { id: string; number: number } | null = { id: "c5", number: 5 }) {
    const calls: any[] = [];
    const cycles = [
      { id: "c4", number: 4, name: "Sprint 4", isPrevious: true, isNext: false },
      { id: "c5", number: 5, name: "Sprint 5", isPrevious: false, isNext: false },
      { id: "c6", number: 6, name: "Sprint 6", isPrevious: false, isNext: true },
      { id: "c7", number: 7, name: "next", isPrevious: false, isNext: false },
    ];
    const team = {
      activeCycle: Promise.resolve(active),
      cycles: async (args: any) => {
        calls.push(args);
        const f = args?.filter ?? {};
        let out = cycles;
        if (f.number?.eq !== undefined) out = out.filter((c) => c.number === f.number.eq);
        if (f.isNext?.eq !== undefined) out = out.filter((c) => c.isNext === f.isNext.eq);
        if (f.isPrevious?.eq !== undefined)
          out = out.filter((c) => c.isPrevious === f.isPrevious.eq);
        return connection(out);
      },
    };
    return { client: { team: async () => team } as any, calls };
  }

  it("'now' is the active cycle, like current/active", async () => {
    const { client } = makeClient();
    expect(await resolveCycleId(client, "t1", "now")).toBe("c5");
    expect(await resolveCycleId(client, "t1", "NOW")).toBe("c5");
  });

  it("'next' and 'previous' use the server-side isNext/isPrevious filters", async () => {
    const { client, calls } = makeClient();
    expect(await resolveCycleId(client, "t1", "next")).toBe("c6");
    expect(calls[0]).toMatchObject({ filter: { isNext: { eq: true } }, first: 1 });
    expect(await resolveCycleId(client, "t1", "previous")).toBe("c4");
    expect(calls[1]).toMatchObject({ filter: { isPrevious: { eq: true } }, first: 1 });
  });

  // A cycle literally named "next" is not what `--cycle next` means; it stays
  // reachable by number or id.
  it("reserved words win over a coincidental cycle name", async () => {
    const { client } = makeClient();
    expect(await resolveCycleId(client, "t1", "next")).toBe("c6");
    expect(await resolveCycleId(client, "t1", "7")).toBe("c7");
  });

  it("'+1' / '-1' offset the active cycle's number", async () => {
    const { client, calls } = makeClient();
    expect(await resolveCycleId(client, "t1", "+1")).toBe("c6");
    expect(calls[0].filter).toEqual({ number: { eq: 6 } });
    expect(await resolveCycleId(client, "t1", "-1")).toBe("c4");
    expect(calls[1].filter).toEqual({ number: { eq: 4 } });
    expect(await resolveCycleId(client, "t1", "+2")).toBe("c7");
  });

  it("an offset that lands on no cycle is not_found and names the target", async () => {
    const { client } = makeClient();
    await expect(resolveCycleId(client, "t1", "+9")).rejects.toThrow(/\+9 \(cycle #14\)/);
    await expect(resolveCycleId(client, "t1", "-9")).rejects.toMatchObject({ code: "not_found" });
  });

  it("offsets and 'now' need an active cycle; 'next' does not", async () => {
    const { client } = makeClient(null);
    await expect(resolveCycleId(client, "t1", "+1")).rejects.toThrow(/no active cycle/);
    await expect(resolveCycleId(client, "t1", "now")).rejects.toMatchObject({ code: "not_found" });
    expect(await resolveCycleId(client, "t1", "next")).toBe("c6");
  });

  it("says so when the team has cycles disabled", async () => {
    const client = {
      team: async () => ({ key: "TES", cyclesEnabled: false, activeCycle: Promise.resolve(null) }),
    } as any;
    await expect(resolveCycleId(client, "t1", "next")).rejects.toThrow(/Cycles are not enabled/);
    await expect(resolveCycleId(client, "t1", "3")).rejects.toMatchObject({ code: "usage" });
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
    await expect(resolveTeam(client, "NOPE", undefined)).rejects.toThrow(/Available: TES, ENG\./);
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
