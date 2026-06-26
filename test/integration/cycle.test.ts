import { describe, it, expect, beforeAll } from "vitest";
import { run, runJson, LIVE, ensureBuilt, FIXTURE_PREFIX } from "./_helpers.js";

const suite = LIVE ? describe : describe.skip;
const TEAM = process.env.LINEAR_CLI_TEST_TEAM || "TES";

/** A pair of ISO dates a couple weeks apart, well in the future to avoid collisions. */
function futureWindow(offsetDays: number): { startsAt: string; endsAt: string } {
  const start = new Date(Date.now() + offsetDays * 86_400_000);
  const end = new Date(start.getTime() + 14 * 86_400_000);
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}

suite("cycle lifecycle (live)", () => {
  beforeAll(() => ensureBuilt());

  it("creates a cycle and returns id + number", () => {
    const w = futureWindow(400);
    const res = runJson<{ id: string; number: number }>([
      "cycle",
      "create",
      TEAM,
      "--name",
      `${FIXTURE_PREFIX}create`,
      "--startsAt",
      w.startsAt,
      "--endsAt",
      w.endsAt,
    ]);
    expect(res.id).toBeTruthy();
    expect(typeof res.number).toBe("number");
  });

  it("lists cycles for a team with the expected columns", () => {
    const rows = runJson<Array<{ number: number; startsAt: string; progress: number }>>([
      "cycle",
      "list",
      TEAM,
    ]);
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length) {
      expect(typeof rows[0]!.number).toBe("number");
      expect(rows[0]!.startsAt).toBeTruthy();
    }
  });

  it("views a cycle by id", () => {
    const w = futureWindow(500);
    const created = runJson<{ id: string; number: number }>([
      "cycle",
      "create",
      TEAM,
      "--name",
      `${FIXTURE_PREFIX}view`,
      "--startsAt",
      w.startsAt,
      "--endsAt",
      w.endsAt,
    ]);
    const d = runJson<{ id: string; number: number; team: string }>(["cycle", "view", created.id]);
    expect(d.id).toBe(created.id);
    expect(d.team).toContain(TEAM);
  });

  it("updates a cycle name by id", () => {
    const w = futureWindow(600);
    const created = runJson<{ id: string; number: number }>([
      "cycle",
      "create",
      TEAM,
      "--name",
      `${FIXTURE_PREFIX}update`,
      "--startsAt",
      w.startsAt,
      "--endsAt",
      w.endsAt,
    ]);
    runJson(["cycle", "update", created.id, "--name", `${FIXTURE_PREFIX}updated`]);
    const d = runJson<{ name: string }>(["cycle", "view", created.id]);
    expect(d.name).toBe(`${FIXTURE_PREFIX}updated`);
  });

  it("reports the team's current cycle or a clean not-found", () => {
    const res = run(["cycle", "current", TEAM, "--json"]);
    // Either an active cycle (exit 0) or a not_found envelope (exit 3).
    if (res.code === 0) {
      const d = JSON.parse(res.stdout);
      expect(typeof d.number).toBe("number");
    } else {
      expect(res.code).toBe(3);
      expect(JSON.parse(res.stderr).error.code).toBe("not_found");
    }
  });

  it("resolves a cycle number when a team is in scope", () => {
    // With --team in scope, a number resolves to a real cycle (0) or not_found (3);
    // it must never be a usage error about the missing team.
    const res = run(["cycle", "view", "1", "--team", TEAM, "--json"]);
    expect([0, 3]).toContain(res.code);
    if (res.code === 3) expect(JSON.parse(res.stderr).error.code).toBe("not_found");
  });
});
