import { describe, it, expect } from "vitest";
import {
  isUuid,
  resolveTeam,
  resolveUserId,
  resolveIssue,
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

describe("STATE_TYPES", () => {
  it("includes the canonical workflow types", () => {
    expect(STATE_TYPES).toContain("started");
    expect(STATE_TYPES).toContain("backlog");
  });
});
