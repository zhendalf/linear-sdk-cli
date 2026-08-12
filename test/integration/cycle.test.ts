import { describe, it, expect, beforeAll } from "bun:test";
import { run, runJson, LIVE, ensureBuilt, FIXTURE_PREFIX } from "./_helpers.js";

const suite = LIVE ? describe : describe.skip;
const TEAM = process.env.LINEAR_CLI_TEST_TEAM || "TES";

const DAY = 86_400_000;

/**
 * A free two-week window, starting a week after the team's last existing cycle.
 *
 * Linear rejects overlapping cycles and has no cycle *delete* (only archive), so
 * fixture cycles accumulate in the test workspace forever. A fixed `now + N days`
 * offset therefore collides with the previous run's fixtures — the suite passed
 * once and then failed for good. Deriving the window from the latest cycle that
 * actually exists (archived ones included, since they still hold their dates)
 * makes each create land after everything before it, so the suite is repeatable
 * no matter how much history the workspace has.
 */
function freeWindow(): { startsAt: string; endsAt: string } {
  const res = run([
    "api",
    `query { team(id: "${TEAM}") { cycles(first: 250, includeArchived: true) { nodes { endsAt } } } }`,
    "--json",
  ]);
  let latest = Date.now();
  if (res.code === 0) {
    for (const n of JSON.parse(res.stdout).team?.cycles?.nodes ?? []) {
      latest = Math.max(latest, Date.parse(n.endsAt) || 0);
    }
  }
  const start = new Date(latest + 7 * DAY);
  return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 14 * DAY).toISOString() };
}

suite("cycle lifecycle (live)", () => {
  beforeAll(() => ensureBuilt());

  it("creates a cycle and returns id + number", () => {
    const w = freeWindow();
    const res = runJson<{ id: string; number: number }>([
      "cycle",
      "create",
      TEAM,
      "--name",
      `${FIXTURE_PREFIX}create`,
      "--start",
      w.startsAt,
      "--end",
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
    const w = freeWindow();
    const created = runJson<{ id: string; number: number }>([
      "cycle",
      "create",
      TEAM,
      "--name",
      `${FIXTURE_PREFIX}view`,
      "--start",
      w.startsAt,
      "--end",
      w.endsAt,
    ]);
    const d = runJson<{ id: string; number: number; team: string }>(["cycle", "view", created.id]);
    expect(d.id).toBe(created.id);
    expect(d.team).toContain(TEAM);
  });

  it("updates a cycle name by id", () => {
    const w = freeWindow();
    const created = runJson<{ id: string; number: number }>([
      "cycle",
      "create",
      TEAM,
      "--name",
      `${FIXTURE_PREFIX}update`,
      "--start",
      w.startsAt,
      "--end",
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
