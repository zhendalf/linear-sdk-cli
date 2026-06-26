import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { LinearClient } from "@linear/sdk";
import { run, runJson, LIVE, LIVE_ADMIN, ensureBuilt, FIXTURE_PREFIX } from "./_helpers.js";

const suite = LIVE ? describe : describe.skip;
const adminSuite = LIVE_ADMIN ? describe : describe.skip;
const TEAM = process.env.LINEAR_CLI_TEST_TEAM || "TES";

suite("team — read-only (live)", () => {
  beforeAll(() => ensureBuilt());

  it("lists teams with key/name/id", () => {
    const rows = runJson<Array<{ key: string; name: string; id: string }>>(["team", "list"]);
    expect(Array.isArray(rows)).toBe(true);
    const t = rows.find((r) => r.key === TEAM);
    expect(t).toBeTruthy();
    expect(t!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("views a team by key with resolved counts", () => {
    const d = runJson<{ key: string; memberCount: number; cyclesEnabled: boolean }>([
      "team",
      "view",
      TEAM,
    ]);
    expect(d.key).toBe(TEAM);
    expect(typeof d.memberCount).toBe("number");
    expect(typeof d.cyclesEnabled).toBe("boolean");
  });

  it("lists team members", () => {
    const rows = runJson<Array<{ displayName: string; email: string }>>(["team", "members", TEAM]);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("email");
  });

  it("lists workflow states sorted by position", () => {
    const rows = runJson<Array<{ name: string; type: string; position: number }>>([
      "team",
      "states",
      TEAM,
    ]);
    expect(rows.length).toBeGreaterThan(0);
    const positions = rows.map((r) => r.position);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("lists team labels", () => {
    const rows = runJson<Array<{ name: string; color: string }>>(["team", "labels", TEAM]);
    expect(Array.isArray(rows)).toBe(true);
  });

  it("lists team cycles", () => {
    const rows = runJson<Array<{ number: number }>>(["team", "cycles", TEAM]);
    expect(Array.isArray(rows)).toBe(true);
  });

  it("falls back to the default team when key omitted", () => {
    const d = runJson<{ key: string }>(["team", "view", "--team", TEAM]);
    expect(d.key).toBe(TEAM);
  });
});

adminSuite("team — create/update (live, admin)", () => {
  const createdIds: string[] = [];
  let client: LinearClient;

  beforeAll(() => {
    ensureBuilt();
    client = new LinearClient({ apiKey: process.env.LINEAR_API_KEY! });
  });

  // No CLI `team delete` (admin/destructive, out of scope) — clean up via SDK.
  afterAll(async () => {
    for (const id of createdIds) {
      try {
        await client.deleteTeam(id);
      } catch {
        // best-effort; the janitor sweeps anything left behind
      }
    }
  });

  function uniqueKey(): string {
    // Team keys are short and uppercase; derive a stable-ish unique 4-char key.
    return ("T" + Math.random().toString(36).slice(2, 5)).toUpperCase();
  }

  /**
   * Create a team, or return "limit" when the workspace plan forbids more teams
   * (free plans cap team count). The CLI surfaces that as a forbidden/exit-4
   * envelope; we skip rather than fail, since it is an environment limit, not a
   * code defect.
   */
  function createTeamOrLimit(name: string): { id: string; key: string; name: string } | "limit" {
    const res = run(["team", "create", "--name", name, "--key", uniqueKey(), "--json"]);
    if (res.code !== 0) {
      const message = JSON.parse(res.stderr).error?.message ?? "";
      if (/limit of teams|upgrade|reached the limit/i.test(message)) return "limit";
      throw new Error(`team create failed (${res.code}): ${res.stderr}`);
    }
    const team = JSON.parse(res.stdout);
    createdIds.push(team.id);
    return team;
  }

  it("creates a team and returns key + id", () => {
    const name = `${FIXTURE_PREFIX}team`;
    const res = createTeamOrLimit(name);
    if (res === "limit") return;
    expect(res.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.name).toBe(name);
  });

  it("updates a team's name", () => {
    const created = createTeamOrLimit(`${FIXTURE_PREFIX}team-upd`);
    if (created === "limit") return;
    const updatedName = `${FIXTURE_PREFIX}team-renamed`;
    const upd = runJson<{ name: string }>(["team", "update", created.key, "--name", updatedName]);
    expect(upd.name).toBe(updatedName);
  });

  it("errors when update is given no fields", () => {
    const res = run(["team", "update", TEAM, "--json"]);
    expect(res.code).toBe(2);
    expect(JSON.parse(res.stderr).error.code).toBe("usage");
  });
});
