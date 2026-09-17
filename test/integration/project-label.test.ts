import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ensureBuilt, FIXTURE_PREFIX, LIVE, run, runJson } from "./_helpers.js";

const suite = LIVE ? describe : describe.skip;
const TEAM = process.env.LINEAR_CLI_TEST_TEAM || "LIN";

suite("project-label — project label lifecycle (live)", () => {
  const labels: string[] = [];
  const projects: string[] = [];

  beforeAll(() => ensureBuilt());

  afterAll(() => {
    for (const id of projects) run(["project", "archive", id, "--yes", "--json"]);
    for (const id of labels) run(["project-label", "delete", id, "--yes", "--json"]);
  });

  function create(name: string, extra: string[] = []) {
    const result = runJson<{ id: string; name: string; color: string }>([
      "project-label",
      "create",
      "--name",
      `${FIXTURE_PREFIX}${name}`,
      ...extra,
    ]);
    labels.unshift(result.id);
    return result;
  }

  it("creates, lists, views by name, and updates a project label", () => {
    const created = create("project-label", ["--color", "#5E6AD2"]);
    const rows = runJson<Array<{ id: string; name: string }>>([
      "project-label",
      "list",
      "--limit",
      "250",
    ]);
    expect(rows.some((row) => row.id === created.id)).toBe(true);
    expect(runJson<{ id: string }>(["project-label", "view", created.name]).id).toBe(created.id);
    const updated = runJson<{ name: string }>([
      "project-label",
      "update",
      created.id,
      "--name",
      `${FIXTURE_PREFIX}project-label-updated`,
    ]);
    expect(updated.name).toBe(`${FIXTURE_PREFIX}project-label-updated`);
  });

  it("creates a group and child, and assigns only the child to a project", () => {
    const group = create("project-label-group", ["--group"]);
    const child = create("project-label-child", ["--parent", group.id]);
    const viewed = runJson<{ parent: { id: string } | null }>(["project-label", "view", child.id]);
    expect(viewed.parent?.id).toBe(group.id);
    const project = runJson<{ id: string }>([
      "project",
      "create",
      "--name",
      `${FIXTURE_PREFIX}project-label-assignment`,
      "--team",
      TEAM,
      "--label",
      child.id,
    ]);
    projects.push(project.id);
    const detail = runJson<{ labels: Array<{ id: string }> }>(["project", "view", project.id]);
    expect(detail.labels.some((label) => label.id === child.id)).toBe(true);
  });

  it("retires, restores, and permanently deletes a project label", () => {
    const created = create("project-label-lifecycle");
    expect(
      runJson<{ retired: boolean }>(["project-label", "retire", created.id, "--yes"]).retired,
    ).toBe(true);
    expect(runJson<{ restored: boolean }>(["project-label", "restore", created.id]).restored).toBe(
      true,
    );
    expect(
      runJson<{ deleted: boolean }>(["project-label", "delete", created.id, "--yes"]).deleted,
    ).toBe(true);
    labels.splice(labels.indexOf(created.id), 1);
  });
});
