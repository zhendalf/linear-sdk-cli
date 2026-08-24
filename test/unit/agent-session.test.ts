import { describe, it, expect } from "bun:test";
import {
  listIssueAgentSessions,
  listAllAgentSessions,
  getAgentSessionDetail,
  AGENT_SESSION_STATUSES,
} from "../../src/services/agent-session.js";
import { rawPage } from "./_fakes.js";

const agent = { id: "a1", name: "Codex Local Agent", displayName: "codexlocalagent" };
const human = { id: "u1", name: "Ada", displayName: "ada" };
const issue = { id: "i1", identifier: "TES-1", title: "Probe" };

/** A session node as the wire returns it. */
function session(id: string, status: string, createdAt: string, extra: any = {}) {
  return {
    id,
    status,
    type: "commentThread",
    summary: null,
    createdAt,
    startedAt: null,
    endedAt: null,
    url: `https://linear.app/x/issue/TES-1#agent-session-${id}`,
    issue,
    appUser: agent,
    creator: human,
    ...extra,
  };
}

/** A client whose rawRequest serves `comments` (per issue) and `sessions` (workspace feed). */
function fakeClient(opts: { comments?: any[]; sessions?: any[]; detail?: any }, seen: any[] = []) {
  return {
    client: {
      rawRequest: async (query: string, vars: any) => {
        seen.push({ query, vars });
        if (query.includes("CliIssueAgentSessions")) {
          return { data: { issue: { comments: rawPage(opts.comments ?? [], vars) } } };
        }
        if (query.includes("CliAgentSessions")) {
          return { data: { agentSessions: rawPage(opts.sessions ?? [], vars) } };
        }
        if (query.includes("CliAgentSessionDetail")) {
          return { data: { agentSession: opts.detail ?? null } };
        }
        throw new Error(`unexpected query ${query.slice(0, 40)}`);
      },
    },
  } as any;
}

describe("listIssueAgentSessions", () => {
  // Comments carry the sessions; most comments carry none.
  const comments = [
    { agentSession: null },
    { agentSession: session("s1", "complete", "2026-08-01T00:00:00.000Z") },
    { agentSession: null },
    { agentSession: session("s2", "awaitingInput", "2026-08-02T00:00:00.000Z") },
    { agentSession: session("s3", "active", "2026-08-03T00:00:00.000Z") },
  ];

  it("maps only the comments that carry a session, newest first, in the shared row shape", async () => {
    const seen: any[] = [];
    const rows = await listIssueAgentSessions(fakeClient({ comments }, seen), "TES-1", 50);
    expect(seen[0].vars.id).toBe("TES-1");
    expect(rows.map((r) => r.id)).toEqual(["s3", "s2", "s1"]);
    expect(rows[2]).toEqual({
      id: "s1",
      status: "complete",
      type: "commentThread",
      summary: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      startedAt: null,
      endedAt: null,
      url: "https://linear.app/x/issue/TES-1#agent-session-s1",
      issue,
      agent,
      creator: human,
    });
  });

  // A limit on comments would not be a limit on sessions: the pages are read to
  // the end and the limit lands on what was found.
  it("pages through every comment and applies the limit to the sessions", async () => {
    const seen: any[] = [];
    const many = Array.from({ length: 150 }, (_, i) => ({
      agentSession:
        i % 3 === 0
          ? session(
              `s${i}`,
              "complete",
              `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.${String(i).padStart(3, "0")}Z`,
            )
          : null,
    }));
    const rows = await listIssueAgentSessions(fakeClient({ comments: many }, seen), "TES-1", 2);
    expect(seen.length).toBe(1); // one 250-node page covers 150 comments
    expect(rows.length).toBe(2);
  });

  it("filters by status after the fetch", async () => {
    const rows = await listIssueAgentSessions(fakeClient({ comments }), "TES-1", 50, {
      status: "awaitingInput",
    });
    expect(rows.map((r) => r.id)).toEqual(["s2"]);
  });

  it("returns an empty list for an issue with no sessions", async () => {
    expect(
      await listIssueAgentSessions(fakeClient({ comments: [{ agentSession: null }] }), "TES-1", 50),
    ).toEqual([]);
  });
});

describe("listAllAgentSessions", () => {
  const sessions = [
    session("s3", "active", "2026-08-03T00:00:00.000Z"),
    session("s2", "awaitingInput", "2026-08-02T00:00:00.000Z"),
    session("s1", "complete", "2026-08-01T00:00:00.000Z"),
  ];

  it("reads the workspace feed with the caller's limit as the page size", async () => {
    const seen: any[] = [];
    const rows = await listAllAgentSessions(fakeClient({ sessions }, seen), 2);
    expect(seen[0].vars.first).toBe(2);
    expect(rows.map((r) => r.id)).toEqual(["s3", "s2"]);
  });

  // The API has no status filter on this connection, so a filtered list must
  // read the whole feed or it would hide matches beyond the first page.
  it("exhausts the feed when a status filter is set, then limits", async () => {
    const seen: any[] = [];
    const rows = await listAllAgentSessions(fakeClient({ sessions }, seen), 1, {
      status: "complete",
    });
    expect(seen[0].vars.first).toBe(250);
    expect(rows.map((r) => r.id)).toEqual(["s1"]);
  });

  it("emits the same row shape as the per-issue listing", async () => {
    const [all] = await listAllAgentSessions(fakeClient({ sessions: [sessions[2]!] }), 50);
    const [one] = await listIssueAgentSessions(
      fakeClient({ comments: [{ agentSession: sessions[2] }] }),
      "TES-1",
      50,
    );
    expect(all).toEqual(one!);
  });
});

describe("getAgentSessionDetail", () => {
  const detail = {
    ...session("s1", "complete", "2026-08-01T00:00:00.000Z", {
      summary: "Did the thing",
      startedAt: "2026-08-01T00:01:00.000Z",
      endedAt: "2026-08-01T00:05:00.000Z",
    }),
    updatedAt: "2026-08-01T00:05:00.000Z",
    dismissedAt: null,
    dismissedBy: null,
    externalLink: "https://example.com/run/1",
    activities: {
      // Newest first, as the API serves them.
      nodes: [
        {
          id: "act3",
          createdAt: "2026-08-01T00:04:00.000Z",
          content: { __typename: "AgentActivityResponseContent", type: "response", body: "Done." },
        },
        {
          id: "act2",
          createdAt: "2026-08-01T00:03:00.000Z",
          content: {
            __typename: "AgentActivityActionContent",
            type: "action",
            action: "Running command",
            parameter: "ls",
            result: null,
          },
        },
        {
          id: "act1",
          createdAt: "2026-08-01T00:02:00.000Z",
          content: {
            __typename: "AgentActivityThoughtContent",
            type: "thought",
            body: "Look around",
          },
        },
      ],
      pageInfo: { hasNextPage: true },
    },
  };

  it("flattens the activity union into one row shape, oldest first, and reports truncation", async () => {
    const seen: any[] = [];
    const d = await getAgentSessionDetail(fakeClient({ detail }, seen), "s1");
    expect(seen[0].vars).toEqual({ id: "s1", activities: 100 });
    expect(d).toMatchObject({
      id: "s1",
      status: "complete",
      summary: "Did the thing",
      agent,
      creator: human,
      issue,
      externalLink: "https://example.com/run/1",
      dismissedAt: null,
      dismissedBy: null,
      activitiesTruncated: true,
    });
    expect(d.activities.map((a) => a.id)).toEqual(["act1", "act2", "act3"]);
    expect(d.activities[0]).toEqual({
      id: "act1",
      createdAt: "2026-08-01T00:02:00.000Z",
      type: "thought",
      body: "Look around",
      action: null,
      parameter: null,
      result: null,
    });
    expect(d.activities[1]).toMatchObject({
      type: "action",
      body: null,
      action: "Running command",
      parameter: "ls",
    });
  });

  it("is a not-found error when the API returns no session", async () => {
    await expect(getAgentSessionDetail(fakeClient({ detail: null }), "nope")).rejects.toMatchObject(
      {
        code: "not_found",
      },
    );
  });
});

describe("AGENT_SESSION_STATUSES", () => {
  it("names every AgentSessionStatus the API defines", () => {
    expect(([...AGENT_SESSION_STATUSES] as string[]).sort()).toEqual(
      ["active", "awaitingInput", "complete", "error", "pending", "stale"].sort(),
    );
  });
});
