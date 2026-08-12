import { describe, it, expect } from "bun:test";
import {
  isUuid,
  resolveTeam,
  resolveUserId,
  resolveIssue,
  resolveCycleId,
  STATE_TYPES,
} from "../../src/lib/resolve.js";
import { CliError } from "../../src/lib/errors.js";

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
    teams: async () => ({
      nodes: [
        { id: "t1", key: "TES", name: "Test" },
        { id: "t2", key: "ENG", name: "Engineering" },
      ],
    }),
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
      if (filter.email) return { nodes: [{ id: "u-email", email: "a@b.com" }] };
      return { nodes: [{ id: "u-name", email: "named@b.com" }] };
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
        return { nodes: [{ id: "iss-1", identifier: "TES-7" }] };
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
        return { nodes: num === undefined ? cycles : cycles.filter((c) => c.number === num) };
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
        cycles: async () => ({
          nodes: [
            { id: "c1", number: 1, name: "Sprint" },
            { id: "c2", number: 2, name: "sprint" },
          ],
        }),
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
