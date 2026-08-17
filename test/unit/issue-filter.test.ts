import { describe, it, expect } from "bun:test";
import {
  buildFilter,
  sortSpec,
  resolveIssueSort,
  listIssues,
  searchIssues,
  updateIssue,
  MINE_STATE_TYPES,
} from "../../src/services/issue.js";
import { connection } from "./_fakes.js";

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
    const f = await buildFilter(client, { state: ["started"] }, undefined);
    expect(f.state).toEqual({ type: { eq: "started" } });
  });

  it("filters a workflow state by name otherwise", async () => {
    const f = await buildFilter(client, { state: ["In Progress"] }, undefined);
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

  // Regression: this used an exact-case `in`, so `--label bug` returned an empty
  // list when the label is stored as "Bug" — wrong results, no error.
  it("matches a single label case-insensitively", async () => {
    const f = await buildFilter(client, { label: ["bug"] }, undefined);
    expect(f.labels).toEqual({ some: { name: { eqIgnoreCase: "bug" } } });
    expect(JSON.stringify(f.labels)).not.toContain('"in"');
  });

  // Repeating --label narrows: the issue must carry *every* label named. This
  // used to be `some: { or: [...] }`, which broadened instead — a superset, and
  // the opposite of what the same script does against the reference CLI.
  it("ANDs repeated labels, each case-insensitively", async () => {
    const f = await buildFilter(client, { label: ["bug", "UI"] }, undefined);
    expect(f.labels).toEqual({
      and: [
        { some: { name: { eqIgnoreCase: "bug" } } },
        { some: { name: { eqIgnoreCase: "UI" } } },
      ],
    });
    // One `some` per label — a single `some` wrapping an `and` would ask one
    // label row to be named both things at once, and match nothing.
    expect(JSON.stringify(f.labels)).not.toContain('"or"');
  });

  it("filters by several state types with `in`", async () => {
    const f = await buildFilter(client, { state: ["unstarted", "Started"] }, undefined);
    expect(f.state).toEqual({ type: { in: ["unstarted", "started"] } });
  });

  // Repeated --state BROADENS (an issue is in exactly one state, so ANDing the
  // clauses could never match anything) — the opposite of repeated --label.
  it("ORs several state names, each case-insensitively", async () => {
    const f = await buildFilter(client, { state: ["In Progress", "In Review"] }, undefined);
    expect(f.state).toEqual({
      or: [{ name: { eqIgnoreCase: "In Progress" } }, { name: { eqIgnoreCase: "In Review" } }],
    });
  });

  // Names must not be folded into `in` alongside the types: `in` is exact-case,
  // so 'in progress' would silently match nothing.
  it("mixes state types and names into one `or`, types collapsed into `in`", async () => {
    const f = await buildFilter(client, { state: ["started", "Done", "backlog"] }, undefined);
    expect(f.state).toEqual({
      or: [{ type: { in: ["started", "backlog"] } }, { name: { eqIgnoreCase: "Done" } }],
    });
  });

  it("keeps the single-state shape when the same state is repeated", async () => {
    const f = await buildFilter(client, { state: ["started", "started"] }, undefined);
    expect(f.state).toEqual({ type: { eq: "started" } });
  });

  // 3.2 — repeatable --team. One key keeps the `eq` shape it always sent.
  it("filters several teams with `in`, uppercased and deduplicated", async () => {
    expect(await buildFilter(client, { team: ["tes", "eng", "TES"] }, undefined)).toEqual({
      team: { key: { in: ["TES", "ENG"] } },
    });
    expect(await buildFilter(client, { team: ["tes"] }, undefined)).toEqual({
      team: { key: { eq: "TES" } },
    });
  });

  it("still lets --all-teams drop several teams", async () => {
    expect(await buildFilter(client, { team: ["TES", "ENG"], allTeams: true }, "TES")).toEqual({});
  });

  // 3.1 — --unassigned.
  it("filters unassigned issues with `null: true`", async () => {
    const f = await buildFilter(client, { unassigned: true }, undefined);
    expect(f.assignee).toEqual({ null: true });
  });

  it("rejects --assignee together with --unassigned rather than picking a winner", async () => {
    await expect(
      buildFilter(client, { unassigned: true, assignee: "me" }, undefined),
    ).rejects.toMatchObject({ code: "usage" });
  });

  // 3.3 — date bounds, normalized to ISO instants and inclusive (`gte`).
  it("sends created/updated bounds as ISO instants", async () => {
    const f = await buildFilter(
      client,
      { createdAfter: "2026-01-15", updatedAfter: "2026-08-01T09:30:00Z" },
      undefined,
    );
    expect(f.createdAt).toEqual({ gte: "2026-01-15T00:00:00.000Z" });
    expect(f.updatedAt).toEqual({ gte: "2026-08-01T09:30:00.000Z" });
  });

  // A garbage bound the API accepts-and-ignores would look like "no matches",
  // so it is rejected locally, naming the flag that carried it.
  it("rejects dates `new Date()` would happily mangle", async () => {
    for (const bad of ["1", "March 2024", "yesterday", "2026-13-45", "01/15/2026"]) {
      await expect(buildFilter(client, { createdAfter: bad }, undefined)).rejects.toMatchObject({
        code: "usage",
      });
    }
    await expect(buildFilter(client, { updatedAfter: "nope" }, undefined)).rejects.toThrow(
      /--updated-after/,
    );
  });

  // 3.4 — --project-label filters on the *project's* label, not the issue's.
  it("filters by the project's label, case-insensitively", async () => {
    const f = await buildFilter(client, { projectLabel: "mobile" }, undefined);
    expect(f.project).toEqual({ labels: { some: { name: { eqIgnoreCase: "mobile" } } } });
  });

  it("rejects --project together with --project-label", async () => {
    await expect(
      buildFilter(client, { project: "Auth", projectLabel: "mobile" }, undefined),
    ).rejects.toMatchObject({ code: "usage" });
  });

  // 3.5 — --milestone. Without --project the SDK can still match by name, so we
  // do not impose the reference CLI's "--milestone requires --project" rule.
  it("filters a milestone by name when no project scopes it", async () => {
    const f = await buildFilter(client, { milestone: "Beta" }, undefined);
    expect(f.projectMilestone).toEqual({ name: { eqIgnoreCase: "Beta" } });
  });

  it("passes a milestone uuid through as an id filter", async () => {
    const uuid = "01234567-89ab-cdef-0123-456789abcdef";
    const f = await buildFilter(client, { milestone: uuid }, undefined);
    expect(f.projectMilestone).toEqual({ id: { eq: uuid } });
  });

  it("resolves a milestone name to an id inside --project", async () => {
    const scoped = {
      ...client,
      projects: async () => connection([{ id: "proj-1", name: "Auth" }]),
      project: async () => ({
        projectMilestones: async () => connection([{ id: "ms-1", name: "Beta" }]),
      }),
    } as any;
    const f = await buildFilter(scoped, { project: "Auth", milestone: "beta" }, undefined);
    expect(f.project).toEqual({ id: { eq: "proj-1" } });
    expect(f.projectMilestone).toEqual({ id: { eq: "ms-1" } });
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

  // Cycle numbers restart per team, so "#3" across two teams names two cycles.
  it("throws a usage error for a cycle number across several teams", async () => {
    await expect(
      buildFilter(client, { cycle: "3", team: ["TES", "ENG"] }, undefined),
    ).rejects.toMatchObject({ code: "usage" });
  });
});

describe("sortSpec (server-side, correct under pagination)", () => {
  // Workflow state first so active work groups above the backlog; it used to be
  // priority alone, which floated backlog items above work in progress.
  // Ascending is deliberate: the API returns Backlog BEFORE In Progress under
  // Descending, which is what the reference CLI ships. See ALIGNMENT.md.
  const PRIORITY_ORDER = [
    { workflowState: { order: "Ascending" } },
    { priority: { nulls: "last", order: "Descending" } },
    { manual: { nulls: "last", order: "Ascending" } },
  ];

  it("orders by workflow state, then priority urgency, then manual", () => {
    expect(sortSpec("priority")).toEqual(PRIORITY_ORDER);
  });
  it("supports updatedAt", () => {
    expect(sortSpec("updated")).toEqual([{ updatedAt: { order: "Descending" } }]);
  });
  it("supports createdAt", () => {
    expect(sortSpec("created")).toEqual([{ createdAt: { order: "Descending" } }]);
  });
  // Callers resolve through resolveIssueSort, so this only guards direct use.
  it("defaults to the documented priority order", () => {
    expect(sortSpec(undefined)).toEqual(PRIORITY_ORDER);
  });
});

describe("listIssues (the wire request `issue mine` produces)", () => {
  function recordingClient(sent: any[]) {
    return {
      viewer: Promise.resolve({ id: "viewer-id" }),
      client: {
        rawRequest: async (_q: string, vars: any) => {
          sent.push(vars);
          return { data: { issues: { nodes: [], pageInfo: { hasNextPage: false } } } };
        },
      },
    } as any;
  }

  it("scopes to the viewer and the default state types", async () => {
    const sent: any[] = [];
    await listIssues(
      recordingClient(sent),
      // `mine` passes its default through the same `state` field as `--state`,
      // so there is exactly one state path in the filter builder.
      { assignee: "me", state: MINE_STATE_TYPES, sort: "priority" },
      50,
      "TES",
    );
    expect(sent[0].filter).toEqual({
      team: { key: { eq: "TES" } },
      assignee: { id: { eq: "viewer-id" } },
      // One type → `eq` (the single-value shape); several would be `in`.
      state: { type: { eq: "unstarted" } },
    });
    expect(sent[0].sort[0]).toEqual({ workflowState: { order: "Ascending" } });
  });

  // Every Phase 3 filter, in one request, asserted on the wire — a filter that
  // silently fails to reach the API has bitten this repo more than once.
  it("puts each Phase 3 filter on the wire", async () => {
    const sent: any[] = [];
    await listIssues(
      recordingClient(sent),
      {
        team: ["tes", "eng"],
        unassigned: true,
        state: ["started", "Done"],
        projectLabel: "Mobile",
        milestone: "Beta",
        createdAfter: "2026-01-01",
        updatedAfter: "2026-06-30",
        sort: "updated",
      },
      50,
      "IGNORED",
    );
    expect(sent[0].filter).toEqual({
      team: { key: { in: ["TES", "ENG"] } },
      assignee: { null: true },
      state: { or: [{ type: { in: ["started"] } }, { name: { eqIgnoreCase: "Done" } }] },
      project: { labels: { some: { name: { eqIgnoreCase: "Mobile" } } } },
      projectMilestone: { name: { eqIgnoreCase: "Beta" } },
      createdAt: { gte: "2026-01-01T00:00:00.000Z" },
      updatedAt: { gte: "2026-06-30T00:00:00.000Z" },
    });
  });

  // --all-states: the command drops stateTypes entirely rather than widening
  // the `in` list, so no state clause reaches the API.
  it("emits no state clause when the state types are omitted", async () => {
    const sent: any[] = [];
    await listIssues(recordingClient(sent), { assignee: "me", sort: "priority" }, 50, "TES");
    expect(sent[0].filter.state).toBeUndefined();
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
    // As the API sends them for a live, in-flight issue: `trashed` is null.
    archivedAt: null,
    trashed: null,
    startedAt: "2026-07-01T00:00:00.000Z",
    completedAt: null,
    canceledAt: null,
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
    // Comment bodies are opt-in: they widen a title/description search a lot.
    expect(sentVars.includeComments).toBe(false);
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
        archivedAt: null,
        trashed: false,
        startedAt: "2026-07-01T00:00:00.000Z",
        completedAt: null,
        canceledAt: null,
      },
    ]);
  });

  // --search-comments is search-only: the plain `issues` query has nowhere to
  // put it, so it rides on searchIssues' own argument rather than the filter.
  it("opts into comment bodies only when asked", async () => {
    const sent: any[] = [];
    const client = {
      client: {
        rawRequest: async (_q: string, vars: any) => {
          sent.push(vars);
          return { data: { searchIssues: { nodes: [], pageInfo: { hasNextPage: false } } } };
        },
      },
    } as any;

    await searchIssues(client, "login", { searchComments: true }, 50, undefined);
    expect(sent[0].includeComments).toBe(true);
    await searchIssues(client, "login", {}, 50, undefined);
    expect(sent[1].includeComments).toBe(false);
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

    await searchIssues(client, "login", { state: ["started"] }, 50, "TES");
    expect(sent[0].filter).toEqual({
      team: { key: { eq: "TES" } },
      state: { type: { eq: "started" } },
    });

    await searchIssues(client, "login", { allTeams: true }, 50, "TES");
    expect(sent[1].filter).toBeUndefined();
  });

  // `search` takes the same core filters as `list` — same builder, so the
  // Phase 3 additions have to reach searchIssues' IssueFilter too.
  it("carries the Phase 3 filters into searchIssues", async () => {
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

    await searchIssues(
      client,
      "login",
      { team: ["TES", "ENG"], unassigned: true, createdAfter: "2026-02-03" },
      50,
      "TES",
    );
    expect(sent[0].filter).toEqual({
      team: { key: { in: ["TES", "ENG"] } },
      assignee: { null: true },
      createdAt: { gte: "2026-02-03T00:00:00.000Z" },
    });
  });
});

describe("updateIssue clearing fields", () => {
  const issue = {
    id: "i1",
    identifier: "TES-1",
    team: Promise.resolve({ id: "team-1" }),
  };
  const base = (capture: (input: any) => void) =>
    ({
      issue: async () => issue,
      issues: async () => ({ nodes: [issue] }),
      updateIssue: async (_id: string, input: any) => {
        capture(input);
        return { success: true, issue: Promise.resolve(issue) };
      },
    }) as any;

  // Linear clears a relation on null, not undefined — undefined means "leave alone".
  it("sends null for --unassign and --clear-cycle", async () => {
    let captured: any;
    await updateIssue(base((i) => (captured = i)), "TES-1", { unassign: true, clearCycle: true });
    expect(captured).toEqual({ assigneeId: null, cycleId: null });
  });

  it("rejects contradictory pairs instead of picking a winner", async () => {
    await expect(
      updateIssue(base(() => {}), "TES-1", { unassign: true, assignee: "me" }),
    ).rejects.toMatchObject({ code: "usage" });
    await expect(
      updateIssue(base(() => {}), "TES-1", { clearCycle: true, cycle: "current" }),
    ).rejects.toMatchObject({ code: "usage" });
  });
});

// 3.6 — `issue update --team` used to be accepted and silently dropped
// (AUDIT.md #8): with no other flag it said "Nothing to update", and with one
// it moved nothing at all.
describe("updateIssue --team (a real team move)", () => {
  const issue = { id: "i1", identifier: "TES-1", team: Promise.resolve({ id: "team-tes" }) };

  /** A client whose team/state/label lookups distinguish TES from ENG. */
  function moveClient(capture: (input: any) => void) {
    return {
      issue: async () => issue,
      issues: async () => connection([issue]),
      teams: async () =>
        connection([
          { id: "team-tes", key: "TES", name: "Test" },
          { id: "team-eng", key: "ENG", name: "Engineering" },
        ]),
      team: async (id: string) => ({
        id,
        states: async () =>
          connection([{ id: `${id}-review`, name: "In Review", type: "started", position: 1 }]),
      }),
      issueLabels: async () =>
        connection([
          { id: "label-eng", name: "bug", team: Promise.resolve({ id: "team-eng" }) },
          { id: "label-tes", name: "bug", team: Promise.resolve({ id: "team-tes" }) },
        ]),
      updateIssue: async (_id: string, input: any) => {
        capture(input);
        return { success: true, issue: Promise.resolve(issue) };
      },
    } as any;
  }

  // AUDIT #6's headline: `updateIssue` used to fall back to the issue it had
  // resolved *before* the mutation, so a payload the API refused still printed
  // "Updated TES-1" and exited 0. The result must come from the payload.
  it("returns the issue the payload carried, not the one it resolved", async () => {
    const before = { id: "i1", identifier: "TES-1", title: "OLD", team: Promise.resolve({ id: "team-tes" }) };
    const after = { id: "i1", identifier: "TES-1", title: "NEW" };
    const client = {
      issues: async () => connection([before]),
      updateIssue: async () => ({ success: true, issue: Promise.resolve(after) }),
    } as any;
    expect(await updateIssue(client, "TES-1", { title: "NEW" })).toBe(after as any);
  });

  it("fails rather than reporting the pre-mutation issue when the API refuses", async () => {
    const before = { id: "i1", identifier: "TES-1", title: "OLD", team: Promise.resolve({ id: "team-tes" }) };
    const client = {
      issues: async () => connection([before]),
      updateIssue: async () => ({ success: false, issue: Promise.resolve(null) }),
    } as any;
    await expect(updateIssue(client, "TES-1", { title: "NEW" })).rejects.toMatchObject({
      code: "api",
      exitCode: 1,
    });
  });

  it("sends teamId for the destination team", async () => {
    let captured: any;
    await updateIssue(moveClient((i) => (captured = i)), "TES-1", { team: "eng" });
    expect(captured).toEqual({ teamId: "team-eng" });
  });

  // The trap: a state/label id from the team the issue is *leaving* is not
  // valid in the team it is joining, and the API rejects it. Everything
  // team-scoped in the same command must resolve against the destination.
  it("resolves state and labels against the destination team, not the current one", async () => {
    let captured: any;
    await updateIssue(moveClient((i) => (captured = i)), "TES-1", {
      team: "ENG",
      state: "In Review",
      addLabel: ["bug"],
    });
    expect(captured).toEqual({
      teamId: "team-eng",
      stateId: "team-eng-review",
      addedLabelIds: ["label-eng"],
    });
  });

  it("leaves the team alone when --team is not passed", async () => {
    let captured: any;
    await updateIssue(moveClient((i) => (captured = i)), "TES-1", { state: "In Review" });
    expect(captured).toEqual({ stateId: "team-tes-review" });
    expect(captured.teamId).toBeUndefined();
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
