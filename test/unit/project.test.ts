import { describe, it, expect } from "bun:test";
import { buildFilter, createProject, updateProject } from "../../src/services/project.js";

const client = {} as any;

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
});

describe("createProject / updateProject (input building)", () => {
  const UUID = "01234567-89ab-cdef-0123-456789abcdef";

  /** A client stub covering team, user and project-label resolution. */
  function stub(capture: (input: any) => void, mutation: "create" | "update") {
    const payload = { project: Promise.resolve({ id: "p1", name: "P", url: "u" }) };
    return {
      teams: async () => ({ nodes: [{ id: "team-1", key: "TES", name: "Test" }] }),
      users: async () => ({ nodes: [{ id: "user-1", email: "a@b.c" }] }),
      project: async (id: string) => ({ id }),
      projectLabels: async (vars: any) => ({
        nodes:
          vars.filter.name.eqIgnoreCase === "platform"
            ? [
                { id: "grp", name: "Platform", isGroup: true },
                { id: "lbl", name: "platform", isGroup: false },
              ]
            : [{ id: "lbl2", name: "infra", isGroup: false }],
      }),
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
