import { describe, it, expect, beforeAll } from "vitest";
import { run, runJson, LIVE, ensureBuilt, FIXTURE_PREFIX } from "./_helpers.js";

const suite = LIVE ? describe : describe.skip;

/**
 * Initiatives are a paid-plan feature and may be disabled on the test
 * workspace. `createInitiativeOrLimit` returns "limit" when the CLI surfaces a
 * plan/forbidden/feature-not-enabled error so the test skips rather than fails.
 */
function createInitiativeOrLimit(
  name: string,
): { id: string; name: string; url: string } | "limit" {
  const res = run(["initiative", "create", "--name", name, "--json"]);
  if (res.code !== 0) {
    const message = (() => {
      try {
        return JSON.parse(res.stderr).error?.message ?? "";
      } catch {
        return res.stderr;
      }
    })();
    if (/plan|upgrade|not enabled|not accessible|forbidden|limit/i.test(message)) return "limit";
    throw new Error(`initiative create failed (${res.code}): ${res.stderr}`);
  }
  return JSON.parse(res.stdout);
}

suite("initiative lifecycle (live)", () => {
  beforeAll(() => ensureBuilt());

  it("lists initiatives (tolerates an empty workspace)", () => {
    const rows = runJson<Array<{ id: string; name: string }>>(["initiative", "list"]);
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length) {
      expect(rows[0]).toHaveProperty("id");
      expect(rows[0]).toHaveProperty("name");
    }
  });

  it("creates an initiative and returns id + name", (ctx) => {
    const created = createInitiativeOrLimit(`${FIXTURE_PREFIX}create`);
    if (created === "limit") return ctx.skip();
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.name).toBe(`${FIXTURE_PREFIX}create`);
    // cleanup
    run(["initiative", "delete", created.id, "--yes", "--json"]);
  });

  it("views an initiative by id", (ctx) => {
    const created = createInitiativeOrLimit(`${FIXTURE_PREFIX}view`);
    if (created === "limit") return ctx.skip();
    const d = runJson<{ id: string; name: string }>(["initiative", "view", created.id]);
    expect(d.id).toBe(created.id);
    expect(d.name).toBe(`${FIXTURE_PREFIX}view`);
    run(["initiative", "delete", created.id, "--yes", "--json"]);
  });

  it("updates an initiative's name and status", (ctx) => {
    const created = createInitiativeOrLimit(`${FIXTURE_PREFIX}update`);
    if (created === "limit") return ctx.skip();
    const renamed = `${FIXTURE_PREFIX}updated`;
    const upd = runJson<{ name: string }>([
      "initiative",
      "update",
      created.id,
      "--name",
      renamed,
      "--status",
      "Active",
    ]);
    expect(upd.name).toBe(renamed);
    const d = runJson<{ status: string }>(["initiative", "view", created.id]);
    expect(d.status).toBe("Active");
    run(["initiative", "delete", created.id, "--yes", "--json"]);
  });

  it("resolves an initiative by name", (ctx) => {
    const name = `${FIXTURE_PREFIX}byname`;
    const created = createInitiativeOrLimit(name);
    if (created === "limit") return ctx.skip();
    const d = runJson<{ id: string }>(["initiative", "view", name]);
    expect(d.id).toBe(created.id);
    run(["initiative", "delete", created.id, "--yes", "--json"]);
  });

  it("archives an initiative", (ctx) => {
    const created = createInitiativeOrLimit(`${FIXTURE_PREFIX}archive`);
    if (created === "limit") return ctx.skip();
    const archived = runJson<{ archived: boolean }>([
      "initiative",
      "archive",
      created.id,
      "--yes",
    ]);
    expect(archived.archived).toBe(true);
    run(["initiative", "delete", created.id, "--yes", "--json"]);
  });

  it("deletes an initiative", (ctx) => {
    const created = createInitiativeOrLimit(`${FIXTURE_PREFIX}delete`);
    if (created === "limit") return ctx.skip();
    const deleted = runJson<{ deleted: boolean }>([
      "initiative",
      "delete",
      created.id,
      "--yes",
    ]);
    expect(deleted.deleted).toBe(true);
  });

  it("errors when update is given no fields", (ctx) => {
    const created = createInitiativeOrLimit(`${FIXTURE_PREFIX}nofields`);
    if (created === "limit") return ctx.skip();
    const res = run(["initiative", "update", created.id, "--json"]);
    expect(res.code).toBe(2);
    expect(JSON.parse(res.stderr).error.code).toBe("usage");
    run(["initiative", "delete", created.id, "--yes", "--json"]);
  });

  it("returns a clean not-found for a bogus name", () => {
    const res = run(["initiative", "view", `${FIXTURE_PREFIX}does-not-exist`, "--json"]);
    // Either not-found (no initiative) or plan-gated; never a crash.
    expect([1, 3]).toContain(res.code);
    if (res.code === 3) expect(JSON.parse(res.stderr).error.code).toBe("not_found");
  });
});
