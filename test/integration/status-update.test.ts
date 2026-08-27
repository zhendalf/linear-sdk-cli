import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { run, runJson, LIVE, ensureBuilt, FIXTURE_PREFIX } from "./_helpers.js";

const suite = LIVE ? describe : describe.skip;
const TEAM = process.env.LINEAR_CLI_TEST_TEAM || "LIN";

interface UpdateRow {
  id: string;
  createdAt: string;
  user: string;
  body: string;
  health: string | null;
  url?: string;
}

suite("project-update lifecycle (live)", () => {
  const projects: string[] = [];

  beforeAll(() => ensureBuilt());
  afterAll(() => {
    for (const id of projects) run(["project", "archive", id, "--yes", "--json"]);
  });

  function makeProject(name: string): string {
    const res = runJson<{ id: string }>([
      "project",
      "create",
      "--name",
      `${FIXTURE_PREFIX}${name}`,
      "--team",
      TEAM,
    ]);
    projects.push(res.id);
    return res.id;
  }

  it("creates a project update with health and lists it back", () => {
    const projectId = makeProject("pu");
    const created = runJson<UpdateRow>([
      "project-update",
      "create",
      projectId,
      "--body",
      `${FIXTURE_PREFIX}on track update`,
      "--health",
      "onTrack",
    ]);
    expect(created.id).toBeTruthy();
    expect(created.health).toBe("onTrack");
    expect(created.body).toContain("on track update");

    const rows = runJson<UpdateRow[]>(["project-update", "list", projectId]);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.some((r) => r.id === created.id)).toBe(true);
  });

  it("rejects an invalid --health value (usage error, before any API call)", () => {
    const res = run([
      "project-update",
      "create",
      "whatever",
      "--body",
      "x",
      "--health",
      "bogus",
      "--json",
    ]);
    expect(res.code).toBe(2);
  });

  it("requires a body (usage error)", () => {
    const projectId = makeProject("pu-nobody");
    const res = run(["project-update", "create", projectId, "--json"]);
    expect(res.code).toBe(2);
    expect(JSON.parse(res.stderr).error.code).toBe("usage");
  });
});

/**
 * Initiatives are a paid-plan feature and may be disabled on the test workspace;
 * tolerate a plan/forbidden error by skipping rather than failing.
 */
function createInitiativeOrLimit(name: string): { id: string } | "limit" {
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

suite("initiative-update lifecycle (live)", () => {
  beforeAll(() => ensureBuilt());

  it("creates an initiative update with health and lists it back", () => {
    const init = createInitiativeOrLimit(`${FIXTURE_PREFIX}iu`);
    if (init === "limit") return;
    try {
      const created = runJson<UpdateRow>([
        "initiative-update",
        "create",
        init.id,
        "--body",
        `${FIXTURE_PREFIX}at risk update`,
        "--health",
        "atRisk",
      ]);
      expect(created.id).toBeTruthy();
      expect(created.health).toBe("atRisk");

      const rows = runJson<UpdateRow[]>(["initiative-update", "list", init.id]);
      expect(rows.some((r) => r.id === created.id)).toBe(true);
    } finally {
      run(["initiative", "delete", init.id, "--yes", "--json"]);
    }
  });
});
