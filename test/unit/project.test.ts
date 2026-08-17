import { describe, it, expect } from "bun:test";
import {
  buildFilter,
  createProject,
  updateProject,
  getProjectDetail,
  deleteProject,
} from "../../src/services/project.js";
import { connection, okPayload, failedPayload } from "./_fakes.js";

const client = {} as any;
const UUID = "01234567-89ab-cdef-0123-456789abcdef";

describe("project buildFilter", () => {
  it("filters by accessible team key (uppercased)", async () => {
    expect(await buildFilter(client, { team: "tes" }, undefined)).toEqual({
      accessibleTeams: { some: { key: { eq: "TES" } } },
    });
  });

  it("uses the default team when none given", async () => {
    expect(await buildFilter(client, {}, "ENG")).toEqual({
      accessibleTeams: { some: { key: { eq: "ENG" } } },
    });
  });

  it("returns an empty filter when no team and no state", async () => {
    expect(await buildFilter(client, {}, undefined)).toEqual({});
  });

  // Regression: this used to build `state: {eq: …}`, the deprecated legacy field,
  // which the API silently ignores — every value returned the unfiltered list.
  it("filters on status, never on the deprecated `state` field", async () => {
    const f = await buildFilter(client, { state: "started" }, undefined);
    expect(f.state).toBeUndefined();
    expect(f.status).toEqual({
      or: [{ name: { eqIgnoreCase: "started" } }, { type: { eqIgnoreCase: "started" } }],
    });
  });

  // Custom status names ("In QA") and status types ("started") are different
  // vocabularies; one flag has to reach both.
  it("matches a custom status name case-insensitively", async () => {
    const f = await buildFilter(client, { state: "in qa" }, undefined);
    expect(f.status).toEqual({
      or: [{ name: { eqIgnoreCase: "in qa" } }, { type: { eqIgnoreCase: "in qa" } }],
    });
  });

  it("combines team and state filters", async () => {
    const f = await buildFilter(client, { team: "tes", state: "completed" }, undefined);
    expect(f).toEqual({
      accessibleTeams: { some: { key: { eq: "TES" } } },
      status: {
        or: [{ name: { eqIgnoreCase: "completed" } }, { type: { eqIgnoreCase: "completed" } }],
      },
    });
  });

  it("prefers an explicit team over the default", async () => {
    const f = await buildFilter(client, { team: "abc" }, "ENG");
    expect(f.accessibleTeams).toEqual({ some: { key: { eq: "ABC" } } });
  });

  // TES-642: the list is scoped to the default team, and the only way out used
  // to be `--team ''`. `--all-teams` drops the team clause entirely.
  it("--all-teams drops the team clause even with a default team configured", async () => {
    expect(await buildFilter(client, { allTeams: true }, "ENG")).toEqual({});
    expect(await buildFilter(client, { allTeams: true, state: "started" }, "ENG")).toEqual({
      status: { or: [{ name: { eqIgnoreCase: "started" } }, { type: { eqIgnoreCase: "started" } }] },
    });
  });
});

describe("createProject / updateProject (input building)", () => {
  const UUID = "01234567-89ab-cdef-0123-456789abcdef";

  /** A client stub covering team, user and project-label resolution. */
  function stub(capture: (input: any) => void, mutation: "create" | "update") {
    const payload = { success: true, project: Promise.resolve({ id: "p1", name: "P", url: "u" }) };
    return {
      teams: async () => connection([{ id: "team-1", key: "TES", name: "Test" }]),
      users: async () => connection([{ id: "user-1", email: "a@b.c" }]),
      project: async (id: string) => ({ id }),
      projectLabels: async (vars: any) =>
        connection(
          vars.filter.name.eqIgnoreCase === "platform"
            ? [
                { id: "grp", name: "Platform", isGroup: true },
                { id: "lbl", name: "platform", isGroup: false },
              ]
            : [{ id: "lbl2", name: "infra", isGroup: false }],
        ),
      createProject: async (input: any) => {
        if (mutation === "create") capture(input);
        return payload;
      },
      updateProject: async (_id: string, input: any) => {
        if (mutation === "update") capture(input);
        return payload;
      },
    } as any;
  }

  // `content` is the markdown body; `description` is the one-line summary. The
  // CLI could previously set only the latter, leaving the body unreachable.
  it("sends content, priority, labels and members alongside description", async () => {
    let captured: any;
    await createProject(
      stub((i) => (captured = i), "create"),
      {
        name: "P",
        description: "one-liner",
        content: "# Body\n\nmarkdown",
        label: ["platform", "infra"],
        member: ["a@b.c", "a@b.c"],
        priority: 2,
        icon: "🚀",
        color: "#EB5757",
      },
      "TES",
    );
    expect(captured).toEqual({
      name: "P",
      teamIds: ["team-1"],
      description: "one-liner",
      content: "# Body\n\nmarkdown",
      priority: 2,
      labelIds: ["lbl", "lbl2"], // label group skipped
      memberIds: ["user-1"], // deduplicated
      icon: "🚀",
      color: "#EB5757",
    });
  });

  it("validates priority locally, before the round-trip", async () => {
    await expect(
      createProject(stub(() => {}, "create"), { name: "P", priority: 7 }, "TES"),
    ).rejects.toMatchObject({ code: "usage" });
  });

  it("leaves untouched fields out of the update input", async () => {
    let captured: any;
    await updateProject(stub((i) => (captured = i), "update"), UUID, { content: "new body" });
    expect(captured).toEqual({ content: "new body" });
  });
});

/**
 * TES-622/627: `project view` fetched the name lookup, the project and five
 * relations one request each (7, measured), and flattened `teams` into
 * `"KEY name"` strings and `lead` into a display name. One tailored query now
 * carries everything, and the relations come back as objects with ids.
 */
describe("getProjectDetail (one round-trip, structured relations)", () => {
  const node = {
    id: UUID,
    name: "Auth",
    description: "one-liner",
    content: "# Body",
    state: "started",
    health: "onTrack",
    progress: 0.25,
    priority: 2,
    priorityLabel: "High",
    url: "https://linear.app/x/project/auth",
    startDate: "2026-01-01",
    targetDate: "2026-03-01",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    completedAt: null,
    archivedAt: null,
    status: { id: "ps-1", name: "In Progress", type: "started" },
    lead: { id: "u-1", displayName: "ada", email: "ada@x.io" },
    labels: { nodes: [{ id: "pl-1", name: "backend" }] },
    teams: { nodes: [{ id: "team-1", key: "TES", name: "Test workspace" }] },
    members: { nodes: [{ id: "u-1", displayName: "ada", email: "ada@x.io" }] },
  };
  function stub(nodes: any[], calls: Array<{ query: string; vars: any }> = []) {
    return {
      client: {
        rawRequest: async (query: string, vars: any) => {
          calls.push({ query, vars });
          return { data: { projects: { nodes } } };
        },
      },
    } as any;
  }

  it("is exactly one request, by name, selecting every relation in the query", async () => {
    const calls: Array<{ query: string; vars: any }> = [];
    const d = await getProjectDetail(stub([node], calls), "auth");
    expect(calls).toHaveLength(1);
    const { query, vars } = calls[0]!;
    // Two, not a page: a second match is already "ambiguous", and a full page
    // times three nested connections is over Linear's complexity cap.
    expect(query).toContain("projects(filter: $filter, first: 2");
    for (const sel of ["status { id name type }", "lead { id displayName email }", "teams(first: 50) { nodes { id key name } }", "members(first: 50) { nodes { id displayName email } }", "labels(first: 50) { nodes { id name } }"]) {
      expect(query).toContain(sel);
    }
    // A name matches live projects only, case-insensitively — as resolveProjectId does.
    expect(vars).toEqual({ filter: { name: { eqIgnoreCase: "auth" } }, includeArchived: false });
    expect(d.id).toBe(UUID);
  });

  it("a UUID filters by id and reaches archived projects too", async () => {
    const calls: Array<{ query: string; vars: any }> = [];
    await getProjectDetail(stub([node], calls), UUID);
    expect(calls[0]!.vars).toEqual({ filter: { id: { eq: UUID } }, includeArchived: true });
  });

  it("returns relations as objects with ids — the row shape plus more, not display strings", async () => {
    const d = await getProjectDetail(stub([node]), "auth");
    expect(d.status).toEqual({ id: "ps-1", name: "In Progress", type: "started" });
    expect(d.lead).toEqual({ id: "u-1", displayName: "ada", email: "ada@x.io" });
    expect(d.teams).toEqual([{ id: "team-1", key: "TES", name: "Test workspace" }]);
    expect(d.members).toEqual([{ id: "u-1", displayName: "ada", email: "ada@x.io" }]);
    expect(d.labels).toEqual([{ id: "pl-1", name: "backend" }]);
    expect(d.archivedAt).toBeNull();
    // Scalars keep their keys.
    expect(d).toMatchObject({ name: "Auth", content: "# Body", state: "started", health: "onTrack", priorityLabel: "High" });
  });

  it("nulls the optional relations rather than inventing placeholders", async () => {
    const d = await getProjectDetail(stub([{ ...node, status: null, lead: null, labels: { nodes: [] }, teams: { nodes: [] }, members: { nodes: [] }, description: "" }]), "auth");
    expect(d.status).toBeNull();
    expect(d.lead).toBeNull();
    expect(d.teams).toEqual([]);
    expect(d.description).toBeNull();
  });

  it("no match → not_found; several → ambiguous, naming them", async () => {
    await expect(getProjectDetail(stub([]), "nope")).rejects.toMatchObject({ code: "not_found" });
    await expect(getProjectDetail(stub([node, { ...node, id: "p2" }]), "auth")).rejects.toMatchObject({
      code: "ambiguous",
      message: expect.stringContaining("Auth, Auth"),
    });
  });
});

/**
 * TES-644: `project delete` trashes (`projectDelete`), which is not `archive`.
 * The service asserts the payload's `success` like every other mutation, and
 * hands back the project it looked up for the receipt.
 */
describe("deleteProject", () => {
  const UUID = "01234567-89ab-cdef-0123-456789abcdef";
  function stub(result: any, seen: string[] = []) {
    return {
      project: async (id: string) => ({ id, name: "Old" }),
      deleteProject: async (id: string) => {
        seen.push(id);
        return result;
      },
      archiveProject: async () => {
        throw new Error("delete must not archive");
      },
    } as any;
  }

  it("calls deleteProject with the resolved id and returns the project", async () => {
    const seen: string[] = [];
    const p = await deleteProject(stub(okPayload(), seen), UUID);
    expect(seen).toEqual([UUID]);
    expect(p).toMatchObject({ id: UUID, name: "Old" });
  });

  it("fails when the API reports success: false", async () => {
    await expect(deleteProject(stub(failedPayload()), UUID)).rejects.toMatchObject({ code: "api" });
  });
});
