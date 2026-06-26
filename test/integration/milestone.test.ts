import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { run, runJson, LIVE, ensureBuilt, FIXTURE_PREFIX } from "./_helpers.js";

const suite = LIVE ? describe : describe.skip;
const TEAM = process.env.LINEAR_CLI_TEST_TEAM || "TES";

suite("milestone — project milestone lifecycle (live)", () => {
  // Milestones are scoped to a project, so we create a throwaway fixture
  // project to host them, then archive it in cleanup.
  let projectId = "";
  const milestones: string[] = [];

  beforeAll(() => {
    ensureBuilt();
    const project = runJson<{ id: string }>([
      "project",
      "create",
      "--name",
      `${FIXTURE_PREFIX}milestone-host`,
      "--team",
      TEAM,
    ]);
    projectId = project.id;
  });

  afterAll(() => {
    for (const id of milestones) run(["milestone", "delete", id, "--yes", "--json"]);
    if (projectId) run(["project", "archive", projectId, "--yes", "--json"]);
  });

  function makeMilestone(name: string, extra: string[] = []): string {
    const res = runJson<{ id: string }>([
      "milestone",
      "create",
      projectId,
      "--name",
      `${FIXTURE_PREFIX}${name}`,
      ...extra,
    ]);
    milestones.push(res.id);
    return res.id;
  }

  it("creates a milestone and returns id + name", () => {
    const res = runJson<{ id: string; name: string }>([
      "milestone",
      "create",
      projectId,
      "--name",
      `${FIXTURE_PREFIX}create`,
      "--target",
      "2026-12-31",
    ]);
    milestones.push(res.id);
    expect(res.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.name).toBe(`${FIXTURE_PREFIX}create`);
  });

  it("views a milestone with its resolved project", () => {
    const id = makeMilestone("view");
    const d = runJson<{ id: string; name: string; project: string | null }>([
      "milestone",
      "view",
      id,
    ]);
    expect(d.id).toBe(id);
    expect(d.name).toBe(`${FIXTURE_PREFIX}view`);
    expect(d.project).toContain("milestone-host");
  });

  it("updates name, description and target date", () => {
    const id = makeMilestone("update");
    runJson([
      "milestone",
      "update",
      id,
      "--name",
      `${FIXTURE_PREFIX}updated`,
      "--description",
      "phase notes",
      "--target",
      "2027-01-15",
    ]);
    const d = runJson<{ name: string; description: string | null; targetDate: string | null }>([
      "milestone",
      "view",
      id,
    ]);
    expect(d.name).toBe(`${FIXTURE_PREFIX}updated`);
    expect(d.description).toContain("phase notes");
    expect(d.targetDate).toBe("2027-01-15");
  });

  it("lists milestones in the project", () => {
    const id = makeMilestone("list");
    const rows = runJson<Array<{ id: string }>>(["milestone", "list", projectId, "--limit", "100"]);
    expect(rows.some((r) => r.id === id)).toBe(true);
  });

  it("deletes a milestone", () => {
    const id = makeMilestone("delete");
    const del = runJson<{ deleted: boolean }>(["milestone", "delete", id, "--yes"]);
    expect(del.deleted).toBe(true);
    const idx = milestones.indexOf(id);
    if (idx >= 0) milestones.splice(idx, 1);
  });

  it("refuses to delete without --yes in non-interactive mode", () => {
    const id = makeMilestone("noyes");
    const res = run(["milestone", "delete", id, "--json"]);
    expect(res.code).toBe(2);
    expect(JSON.parse(res.stderr).error.code).toBe("usage");
  });

  it("errors with a usage code when update has no fields", () => {
    const id = makeMilestone("noop");
    const res = run(["milestone", "update", id, "--json"]);
    expect(res.code).toBe(2);
    expect(JSON.parse(res.stderr).error.code).toBe("usage");
  });
});
