import { describe, it, expect } from "bun:test";
import { buildFilter, sortSpec, resolveIssueSort, searchIssues } from "../../src/services/issue.js";

const client = {
  viewer: Promise.resolve({ id: "viewer-id" }),
} as any;

describe("buildFilter", () => {
  it("filters by team key (uppercased)", async () => {
    expect(await buildFilter(client, { team: "tes" }, undefined)).toEqual({
      team: { key: { eq: "TES" } },
    });
  });

  it("uses the default team when none given", async () => {
    expect(await buildFilter(client, {}, "ENG")).toEqual({ team: { key: { eq: "ENG" } } });
  });

  it("filters a workflow state by type when it is a known type", async () => {
    const f = await buildFilter(client, { state: "started" }, undefined);
    expect(f.state).toEqual({ type: { eq: "started" } });
  });

  it("filters a workflow state by name otherwise", async () => {
    const f = await buildFilter(client, { state: "In Progress" }, undefined);
    expect(f.state).toEqual({ name: { eqIgnoreCase: "In Progress" } });
  });

  it("resolves assignee 'me' to the viewer id", async () => {
    const f = await buildFilter(client, { assignee: "me" }, undefined);
    expect(f.assignee).toEqual({ id: { eq: "viewer-id" } });
  });

  it("filters by priority as an integer", async () => {
    const f = await buildFilter(client, { priority: "2" }, undefined);
    expect(f.priority).toEqual({ eq: 2 });
  });

  it("filters by labels using a 'some' collection match", async () => {
    const f = await buildFilter(client, { label: ["bug", "ui"] }, undefined);
    expect(f.labels).toEqual({ some: { name: { in: ["bug", "ui"] } } });
  });

  it("filters by free-text query against searchable content", async () => {
    const f = await buildFilter(client, { query: "crash" }, undefined);
    expect(f.searchableContent).toEqual({ contains: "crash" });
  });

  it("passes a cycle uuid through directly", async () => {
    const uuid = "01234567-89ab-cdef-0123-456789abcdef";
    const f = await buildFilter(client, { cycle: uuid }, undefined);
    expect(f.cycle).toEqual({ id: { eq: uuid } });
  });

  it("throws a usage error for a cycle number without a team", async () => {
    await expect(buildFilter(client, { cycle: "3" }, undefined)).rejects.toMatchObject({
      code: "usage",
    });
  });
});

describe("sortSpec (server-side, correct under pagination)", () => {
  it("orders priority by urgency descending (Urgent first), no-priority last", () => {
    expect(sortSpec("priority")).toEqual([
      { priority: { order: "Descending", noPriorityFirst: false } },
    ]);
  });
  it("supports updatedAt", () => {
    expect(sortSpec("updated")).toEqual([{ updatedAt: { order: "Descending" } }]);
  });
  it("supports createdAt", () => {
    expect(sortSpec("created")).toEqual([{ createdAt: { order: "Descending" } }]);
  });
  // Callers resolve through resolveIssueSort, so this only guards direct use.
  it("defaults to the documented priority order", () => {
    expect(sortSpec(undefined)).toEqual([
      { priority: { order: "Descending", noPriorityFirst: false } },
    ]);
  });
});

describe("searchIssues", () => {
  const node = {
    id: "i1",
    identifier: "TES-1",
    title: "Broken login",
    priority: 1,
    priorityLabel: "Urgent",
    estimate: 3,
    url: "https://linear.app/x/issue/TES-1",
    updatedAt: "2026-08-01T00:00:00.000Z",
    state: { name: "In Progress", type: "started" },
    assignee: { displayName: "ada" },
    project: { name: "Auth" },
    labels: { nodes: [{ name: "bug" }, { name: "regression" }] },
  };

  // Regression: the old SDK-model path hardcoded labels: [], so `issue search
  // --json` reported no labels while `issue list --json` reported the real ones.
  it("carries labels and matches the list row shape in one round-trip", async () => {
    let calls = 0;
    let sentQuery = "";
    let sentVars: any;
    const client = {
      client: {
        rawRequest: async (query: string, vars: any) => {
          calls++;
          sentQuery = query;
          sentVars = vars;
          return {
            data: { searchIssues: { nodes: [node], pageInfo: { hasNextPage: false } } },
          };
        },
      },
    } as any;

    const rows = await searchIssues(client, "login", {}, 50, undefined);
    expect(calls).toBe(1);
    expect(sentQuery).toContain("searchIssues(term: $term");
    expect(sentVars).toMatchObject({ term: "login", first: 50 });
    // No filters and no default team → no IssueFilter at all, not an empty object.
    expect(sentVars.filter).toBeUndefined();
    expect(rows).toEqual([
      {
        id: "i1",
        identifier: "TES-1",
        title: "Broken login",
        priority: 1,
        priorityLabel: "Urgent",
        estimate: 3,
        url: "https://linear.app/x/issue/TES-1",
        updatedAt: "2026-08-01T00:00:00.000Z",
        state: { name: "In Progress", type: "started" },
        assignee: { displayName: "ada" },
        project: { name: "Auth" },
        labels: ["bug", "regression"],
      },
    ]);
  });

  it("passes the built IssueFilter through, and --all-teams drops the team scope", async () => {
    const sent: any[] = [];
    const client = {
      viewer: Promise.resolve({ id: "viewer-id" }),
      client: {
        rawRequest: async (_q: string, vars: any) => {
          sent.push(vars);
          return { data: { searchIssues: { nodes: [], pageInfo: { hasNextPage: false } } } };
        },
      },
    } as any;

    await searchIssues(client, "login", { state: "started" }, 50, "TES");
    expect(sent[0].filter).toEqual({
      team: { key: { eq: "TES" } },
      state: { type: { eq: "started" } },
    });

    await searchIssues(client, "login", { allTeams: true }, 50, "TES");
    expect(sent[1].filter).toBeUndefined();
  });
});

describe("resolveIssueSort", () => {
  const config = {
    sort: "priority",
    sortSource: "none" as const,
    userConfigPath: "/home/u/.config/linear/config.toml",
    projectConfigPath: "/repo/.linear.toml",
  };

  it("prefers the explicit flag over the configured value", () => {
    expect(resolveIssueSort("created", { ...config, sort: "updated", sortSource: "user" })).toBe(
      "created",
    );
  });

  it("falls back to the configured value, then to priority", () => {
    expect(resolveIssueSort(undefined, { ...config, sort: "updated", sortSource: "env" })).toBe(
      "updated",
    );
    expect(resolveIssueSort(undefined, config)).toBe("priority");
  });

  // Regression: an unrecognized configured value used to fall through sortSpec's
  // default and silently sort by updatedAt.
  it("rejects an invalid configured value and names its source", () => {
    expect(() =>
      resolveIssueSort(undefined, { ...config, sort: "banana", sortSource: "env" }),
    ).toThrow(/Invalid sort 'banana' \(LINEAR_ISSUE_SORT\)\. Valid values: priority, updated, created\./);

    expect(() =>
      resolveIssueSort(undefined, { ...config, sort: "banana", sortSource: "project" }),
    ).toThrow(/`sort` in \/repo\/\.linear\.toml/);

    expect(() =>
      resolveIssueSort(undefined, { ...config, sort: "banana", sortSource: "user" }),
    ).toThrow(/`sort` in \/home\/u\/\.config\/linear\/config\.toml/);

    expect(() => resolveIssueSort(undefined, { ...config, sort: "banana", sortSource: "env" })).toThrow(
      expect.objectContaining({ code: "usage" }),
    );
  });

  it("blames the flag when the flag is the bad value", () => {
    expect(() => resolveIssueSort("banana", config)).toThrow(/\(--sort\)/);
  });
});
