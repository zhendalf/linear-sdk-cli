import { describe, it, expect, beforeAll } from "bun:test";
import { run, runJson, LIVE, ensureBuilt, FIXTURE_PREFIX } from "./_helpers.js";

const suite = LIVE ? describe : describe.skip;

/**
 * Roadmaps are deprecated in Linear (the API rejects creation: "Roadmaps are
 * deprecated, use initiatives instead") and plan-gated on some plans. A create
 * the workspace forbids surfaces as a forbidden / feature-not-accessible /
 * deprecated / plan-limit envelope; we treat that as an environment limit
 * (skip), not a code defect — the read paths (list/view) are still exercised.
 */
const LIMIT_RE = /plan|upgrade|not enabled|not accessible|forbidden|limit|feature|deprecated/i;

interface Created {
  id: string;
  name: string;
  url: string;
}

/** Create a roadmap, or return "limit" when the plan forbids it. */
function createRoadmapOrLimit(name: string): Created | "limit" {
  const res = run(["roadmap", "create", "--name", name, "--json"]);
  if (res.code !== 0) {
    const message = (() => {
      try {
        return JSON.parse(res.stderr).error?.message ?? "";
      } catch {
        return res.stderr;
      }
    })();
    if (LIMIT_RE.test(message)) return "limit";
    throw new Error(`roadmap create failed (${res.code}): ${res.stderr}`);
  }
  return JSON.parse(res.stdout) as Created;
}

suite("roadmap lifecycle (live)", () => {
  beforeAll(() => ensureBuilt());

  it("lists roadmaps as an array (possibly empty)", () => {
    const rows = runJson<Array<{ id: string; name: string }>>(["roadmap", "list"]);
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length) {
      expect(rows[0]).toHaveProperty("name");
      expect(rows[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("creates a roadmap and returns id + url", () => {
    const res = createRoadmapOrLimit(`${FIXTURE_PREFIX}create`);
    if (res === "limit") return;
    expect(res.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.url).toBeTruthy();
    // cleanup
    run(["roadmap", "delete", res.id, "--yes"]);
  });

  it("views a created roadmap by id with its projects array", () => {
    const created = createRoadmapOrLimit(`${FIXTURE_PREFIX}view`);
    if (created === "limit") return;
    try {
      const d = runJson<{ id: string; name: string; projects: string[] }>([
        "roadmap",
        "view",
        created.id,
      ]);
      expect(d.id).toBe(created.id);
      expect(Array.isArray(d.projects)).toBe(true);
    } finally {
      run(["roadmap", "delete", created.id, "--yes"]);
    }
  });

  it("updates a roadmap's name by id", () => {
    const created = createRoadmapOrLimit(`${FIXTURE_PREFIX}update`);
    if (created === "limit") return;
    try {
      const renamed = `${FIXTURE_PREFIX}renamed`;
      runJson(["roadmap", "update", created.id, "--name", renamed]);
      const d = runJson<{ name: string }>(["roadmap", "view", created.id]);
      expect(d.name).toBe(renamed);
    } finally {
      run(["roadmap", "delete", created.id, "--yes"]);
    }
  });

  it("deletes a roadmap by id", () => {
    const created = createRoadmapOrLimit(`${FIXTURE_PREFIX}delete`);
    if (created === "limit") return;
    const del = runJson<{ id: string; deleted: boolean }>([
      "roadmap",
      "delete",
      created.id,
      "--yes",
    ]);
    expect(del.deleted).toBe(true);
    // a subsequent view should be a clean not-found
    const res = run(["roadmap", "view", created.id, "--json"]);
    expect(res.code).toBe(3);
  });

  it("errors with a clean not-found for a missing roadmap name", () => {
    const res = run(["roadmap", "view", `${FIXTURE_PREFIX}does-not-exist`, "--json"]);
    expect(res.code).toBe(3);
    expect(JSON.parse(res.stderr).error.code).toBe("not_found");
  });

  it("errors when update is given no fields", () => {
    const created = createRoadmapOrLimit(`${FIXTURE_PREFIX}noop`);
    if (created === "limit") return;
    try {
      const res = run(["roadmap", "update", created.id, "--json"]);
      expect(res.code).toBe(2);
      expect(JSON.parse(res.stderr).error.code).toBe("usage");
    } finally {
      run(["roadmap", "delete", created.id, "--yes"]);
    }
  });
});
