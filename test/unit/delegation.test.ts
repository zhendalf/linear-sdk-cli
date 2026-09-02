import { describe, expect, it } from "bun:test";
import { resolveDelegate } from "../../src/lib/delegation.js";
import {
  executeIssueCreate,
  executeIssueUpdate,
  prepareIssueCreate,
  prepareIssueUpdate,
  verifyIssueDelegate,
} from "../../src/services/issue.js";
import { connection, payload } from "./_fakes.js";

const TEAM_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const AGENT_ID = "bbbbbbbb-0000-0000-0000-000000000001";

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: AGENT_ID,
    displayName: "Codex",
    name: "OpenAI Codex",
    active: true,
    app: true,
    isAssignable: true,
    canAccessAnyPublicTeam: false,
    teams: { nodes: [{ id: TEAM_ID }] },
    ...overrides,
  };
}

function client(
  users: any[],
  options: { privateTeam?: boolean; userById?: any; error?: Error } = {},
) {
  return {
    team: async () => ({ id: TEAM_ID, key: "TES", private: options.privateTeam ?? false }),
    client: {
      rawRequest: async (query: string, variables: any) => {
        if (options.error) throw options.error;
        if (query.includes("CliDelegateCandidate(")) {
          return {
            data: {
              user:
                options.userById === undefined
                  ? (users.find((user) => user.id === variables.id) ?? null)
                  : options.userById,
            },
          };
        }
        return {
          data: {
            users: {
              nodes: users,
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      },
    },
  } as any;
}

describe("resolveDelegate", () => {
  it("resolves a UUID and validates the returned app user", async () => {
    expect(await resolveDelegate(client([candidate()]), AGENT_ID, TEAM_ID)).toEqual({
      id: AGENT_ID,
      displayName: "Codex",
      name: "OpenAI Codex",
    });
  });

  it("handles a UUID lookup returning user: null", async () => {
    await expect(
      resolveDelegate(client([], { userById: null }), AGENT_ID, TEAM_ID),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("matches exact display name or full name", async () => {
    expect((await resolveDelegate(client([candidate()]), "Codex", TEAM_ID)).id).toBe(AGENT_ID);
    expect((await resolveDelegate(client([candidate()]), "OpenAI Codex", TEAM_ID)).id).toBe(
      AGENT_ID,
    );
  });

  it("prefers an exact-case match before case-insensitive matches", async () => {
    const exact = candidate();
    const other = candidate({
      id: "bbbbbbbb-0000-0000-0000-000000000002",
      displayName: "codex",
      name: "codex",
    });
    expect((await resolveDelegate(client([other, exact]), "Codex", TEAM_ID)).id).toBe(AGENT_ID);
  });

  it("reports eligible ambiguity with safe names and ids", async () => {
    const otherId = "bbbbbbbb-0000-0000-0000-000000000002";
    await expect(
      resolveDelegate(
        client([candidate(), candidate({ id: otherId, name: "Codex", displayName: "Codex" })]),
        "Codex",
        TEAM_ID,
      ),
    ).rejects.toMatchObject({
      code: "ambiguous",
      message: expect.stringContaining(otherId),
    });
  });

  it("ignores a same-name agent that cannot access the target team", async () => {
    const inaccessible = candidate({
      id: "bbbbbbbb-0000-0000-0000-000000000002",
      teams: { nodes: [] },
    });
    const resolved = await resolveDelegate(client([candidate(), inaccessible]), "Codex", TEAM_ID);
    expect(resolved.id).toBe(AGENT_ID);
  });

  it("rejects a human user instead of treating them as an agent", async () => {
    await expect(
      resolveDelegate(client([candidate({ app: false })]), "Codex", TEAM_ID),
    ).rejects.toMatchObject({ code: "validation", message: expect.stringContaining("human user") });
  });

  it("rejects inactive and non-assignable app users", async () => {
    await expect(
      resolveDelegate(client([candidate({ active: false })]), "Codex", TEAM_ID),
    ).rejects.toMatchObject({ code: "validation", message: expect.stringContaining("inactive") });
    await expect(
      resolveDelegate(client([candidate({ isAssignable: false })]), "Codex", TEAM_ID),
    ).rejects.toMatchObject({
      code: "validation",
      message: expect.stringContaining("not eligible"),
    });
  });

  it("requires private-team membership but accepts public-team access", async () => {
    const publicAgent = candidate({ teams: { nodes: [] }, canAccessAnyPublicTeam: true });
    expect((await resolveDelegate(client([publicAgent]), "Codex", TEAM_ID)).id).toBe(AGENT_ID);
    await expect(
      resolveDelegate(client([publicAgent], { privateTeam: true }), "Codex", TEAM_ID),
    ).rejects.toMatchObject({
      code: "validation",
      message: expect.stringContaining("cannot access team TES"),
    });
  });

  it("maps an unavailable preview schema to a stable feature boundary", async () => {
    await expect(
      resolveDelegate(
        client([], { error: new Error('Cannot query field "isAssignable" on type "User".') }),
        "Codex",
        TEAM_ID,
      ),
    ).rejects.toMatchObject({ code: "feature_not_accessible" });
  });
});

describe("issue delegation mutation plans", () => {
  function mutationClient(calls: { create: any[]; update: any[] }) {
    const agent = candidate();
    const team = { id: TEAM_ID, key: "TES", name: "Test", private: false };
    const issue = {
      id: "issue-1",
      identifier: "TES-1",
      team: Promise.resolve(team),
    };
    return {
      teams: async () => connection([team]),
      team: async () => team,
      issues: async () => connection([issue]),
      viewer: Promise.resolve({ id: "viewer-1" }),
      createIssue: async (input: any) => {
        calls.create.push(input);
        return payload("issue", { id: "issue-2", identifier: "TES-2" });
      },
      updateIssue: async (_id: string, input: any) => {
        calls.update.push(input);
        return payload("issue", issue);
      },
      client: {
        rawRequest: async (query: string) => {
          if (query.includes("CliDelegateCandidates")) {
            return {
              data: {
                users: {
                  nodes: [agent],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            };
          }
          throw new Error(`Unexpected query: ${query}`);
        },
      },
    } as any;
  }

  it("keeps assignee and delegate as distinct create fields", async () => {
    const calls = { create: [] as any[], update: [] as any[] };
    const plan = await prepareIssueCreate(
      mutationClient(calls),
      { title: "t", team: "TES", assignee: "me", delegate: "Codex" },
      undefined,
    );
    expect(plan.input).toMatchObject({
      assigneeId: "viewer-1",
      delegateId: AGENT_ID,
    });
    expect(calls.create).toEqual([]);
    await executeIssueCreate(mutationClient(calls), plan);
    expect(calls.create).toEqual([plan.input]);
  });

  it("distinguishes delegate omission from explicit clear on create and update", async () => {
    const calls = { create: [] as any[], update: [] as any[] };
    const c = mutationClient(calls);
    const omitted = await prepareIssueCreate(c, { title: "t", team: "TES" }, undefined);
    expect("delegateId" in omitted.input).toBe(false);
    const clearedCreate = await prepareIssueCreate(
      c,
      { title: "t", team: "TES", clearDelegate: true },
      undefined,
    );
    expect(clearedCreate.input.delegateId).toBeNull();
    const clearedUpdate = await prepareIssueUpdate(c, "TES-1", { clearDelegate: true });
    expect(clearedUpdate.input).toEqual({ delegateId: null });
  });

  it("rejects set and clear together before a mutation", async () => {
    const calls = { create: [] as any[], update: [] as any[] };
    await expect(
      prepareIssueUpdate(mutationClient(calls), "TES-1", {
        delegate: "Codex",
        clearDelegate: true,
      }),
    ).rejects.toMatchObject({ code: "usage" });
    expect(calls.update).toEqual([]);
  });

  it("executes the exact prepared update input", async () => {
    const calls = { create: [] as any[], update: [] as any[] };
    const c = mutationClient(calls);
    const plan = await prepareIssueUpdate(c, "TES-1", {
      assignee: "me",
      delegate: "Codex",
    });
    expect(plan.input).toEqual({ assigneeId: "viewer-1", delegateId: AGENT_ID });
    expect(calls.update).toEqual([]);
    await executeIssueUpdate(c, plan);
    expect(calls.update).toEqual([plan.input]);
  });

  it("maps a missing delegation mutation field to the preview feature boundary", async () => {
    const calls = { create: [] as any[], update: [] as any[] };
    const c = mutationClient(calls);
    c.updateIssue = async () => {
      throw new Error('Field "delegateId" is not defined by type "IssueUpdateInput".');
    };
    await expect(
      executeIssueUpdate(c, {
        operation: "issue.delegate",
        target: { id: "issue-1", identifier: "TES-1" },
        input: { delegateId: AGENT_ID },
      }),
    ).rejects.toMatchObject({ code: "feature_not_accessible" });
  });

  it("fails honestly when a successful mutation reads back the wrong delegate", () => {
    expect(() => verifyIssueDelegate({ delegate: null } as any, { delegateId: AGENT_ID })).toThrow(
      /mutation succeeded.*write may have committed/i,
    );
    expect(() =>
      verifyIssueDelegate({ delegate: null } as any, { delegateId: null }),
    ).not.toThrow();
  });
});
