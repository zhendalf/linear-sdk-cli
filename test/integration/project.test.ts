import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { run, runJson, LIVE, ensureBuilt, FIXTURE_PREFIX } from "./_helpers.js";

const suite = LIVE ? describe : describe.skip;
const TEAM = process.env.LINEAR_CLI_TEST_TEAM || "TES";

suite("project — project lifecycle (live)", () => {
  const created: string[] = [];

  beforeAll(() => ensureBuilt());

  afterAll(() => {
    // Best-effort cleanup; the janitor sweeps anything this misses.
    for (const id of created) run(["project", "archive", id, "--yes", "--json"]);
  });

  function makeProject(name: string, extra: string[] = []): { id: string; name: string } {
    const res = runJson<{ id: string; name: string }>([
      "project",
      "create",
      "--name",
      `${FIXTURE_PREFIX}${name}`,
      "--team",
      TEAM,
      ...extra,
    ]);
    created.push(res.id);
    return res;
  }

  it("creates a project and returns id + url", () => {
    const res = runJson<{ id: string; name: string; url: string }>([
      "project",
      "create",
      "--name",
      `${FIXTURE_PREFIX}create`,
      "--team",
      TEAM,
      "--description",
      "made by the test suite",
    ]);
    created.push(res.id);
    expect(res.id).toBeTruthy();
    expect(res.url).toContain("linear.app");
  });

  it("views a project with resolved relations", () => {
    const { id, name } = makeProject("view");
    const d = runJson<{ id: string; name: string; teams: string[] }>(["project", "view", id]);
    expect(d.id).toBe(id);
    expect(d.name).toBe(name);
    expect(d.teams.some((t) => t.includes(TEAM))).toBe(true);
  });

  it("updates name and description", () => {
    const { id } = makeProject("update");
    runJson(["project", "update", id, "--name", `${FIXTURE_PREFIX}updated`, "--lead", "me"]);
    const d = runJson<{ name: string; lead: string | null }>(["project", "view", id]);
    expect(d.name).toBe(`${FIXTURE_PREFIX}updated`);
    expect(d.lead).toBeTruthy();
  });

  it("lists projects filtered by team", () => {
    const { id } = makeProject("list");
    const rows = runJson<Array<{ id: string }>>([
      "project",
      "list",
      "--team",
      TEAM,
      "--limit",
      "100",
    ]);
    expect(rows.some((r) => r.id === id)).toBe(true);
  });

  it("lists project milestones and updates (possibly empty)", () => {
    const { id } = makeProject("ms");
    const milestones = runJson<Array<unknown>>(["project", "milestones", id]);
    expect(Array.isArray(milestones)).toBe(true);
    const updates = runJson<Array<unknown>>(["project", "updates", id]);
    expect(Array.isArray(updates)).toBe(true);
  });

  it("archives a project", () => {
    const { id } = makeProject("archive");
    const res = runJson<{ archived: boolean }>(["project", "archive", id, "--yes"]);
    expect(res.archived).toBe(true);
    const idx = created.indexOf(id);
    if (idx >= 0) created.splice(idx, 1);
  });

  it("refuses to archive without --yes in non-interactive mode", () => {
    const { id } = makeProject("noyes");
    const res = run(["project", "archive", id, "--json"]);
    expect(res.code).toBe(2);
    expect(JSON.parse(res.stderr).error.code).toBe("usage");
  });
});
