import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { run, runJson, LIVE, ensureBuilt, FIXTURE_PREFIX } from "./_helpers.js";

const suite = LIVE ? describe : describe.skip;
const TEAM = process.env.LINEAR_CLI_TEST_TEAM || "TES";

suite("label — issue label lifecycle (live)", () => {
  // Track created labels so we can sweep them in cleanup even if a test fails.
  const labels: string[] = [];

  beforeAll(() => ensureBuilt());

  afterAll(() => {
    for (const id of labels) run(["label", "delete", id, "--yes", "--json"]);
  });

  function makeLabel(name: string, extra: string[] = []): { id: string; name: string } {
    const res = runJson<{ id: string; name: string }>([
      "label",
      "create",
      "--name",
      `${FIXTURE_PREFIX}${name}`,
      "--team",
      TEAM,
      ...extra,
    ]);
    labels.push(res.id);
    return res;
  }

  it("creates a team-scoped label and returns id + name + color", () => {
    const res = runJson<{ id: string; name: string; color: string }>([
      "label",
      "create",
      "--name",
      `${FIXTURE_PREFIX}create`,
      "--color",
      "#EB5757",
      "--team",
      TEAM,
    ]);
    labels.push(res.id);
    expect(res.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.name).toBe(`${FIXTURE_PREFIX}create`);
    expect(res.color.toLowerCase()).toBe("#eb5757");
  });

  it("lists labels scoped to a team", () => {
    const created = makeLabel("list");
    const rows = runJson<Array<{ id: string; name: string; team: { key: string } | null }>>([
      "label",
      "list",
      TEAM,
      "--limit",
      "250",
    ]);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.some((r) => r.id === created.id)).toBe(true);
  });

  it("updates name and color by id", () => {
    const created = makeLabel("update");
    runJson([
      "label",
      "update",
      created.id,
      "--name",
      `${FIXTURE_PREFIX}updated`,
      "--color",
      "#5E6AD2",
    ]);
    const rows = runJson<Array<{ id: string; name: string; color: string }>>([
      "label",
      "list",
      TEAM,
      "--limit",
      "250",
    ]);
    const found = rows.find((r) => r.id === created.id);
    expect(found?.name).toBe(`${FIXTURE_PREFIX}updated`);
    expect(found?.color.toLowerCase()).toBe("#5e6ad2");
  });

  it("updates a label by name", () => {
    makeLabel("byname");
    const res = runJson<{ name: string }>([
      "label",
      "update",
      `${FIXTURE_PREFIX}byname`,
      "--description",
      "resolved by name",
    ]);
    expect(res.name).toBe(`${FIXTURE_PREFIX}byname`);
  });

  it("deletes a label", () => {
    const created = makeLabel("delete");
    const del = runJson<{ deleted: boolean }>(["label", "delete", created.id, "--yes"]);
    expect(del.deleted).toBe(true);
    const idx = labels.indexOf(created.id);
    if (idx >= 0) labels.splice(idx, 1);
  });

  it("refuses to delete without --yes in non-interactive mode", () => {
    const created = makeLabel("noyes");
    const res = run(["label", "delete", created.id, "--json"]);
    expect(res.code).toBe(2);
    expect(JSON.parse(res.stderr).error.code).toBe("usage");
  });

  it("errors with a usage code when update has no fields", () => {
    const created = makeLabel("noop");
    const res = run(["label", "update", created.id, "--json"]);
    expect(res.code).toBe(2);
    expect(JSON.parse(res.stderr).error.code).toBe("usage");
  });
});
