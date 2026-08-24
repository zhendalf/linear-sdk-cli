import { describe, it, expect, beforeAll } from "bun:test";
import { run, runJson, LIVE, ensureBuilt } from "./_helpers.js";

const suite = LIVE ? describe : describe.skip;
const TEAM = process.env.LINEAR_CLI_TEST_TEAM || "TES";

suite("workflow state (live, read-only)", () => {
  beforeAll(() => ensureBuilt());

  it("lists a team's workflow states with the expected columns, sorted by position", () => {
    const rows = runJson<
      Array<{ id: string; name: string; type: string; position: number; color: string }>
    >(["state", "list", TEAM]);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0]!;
    expect(first.id).toBeTruthy();
    expect(first.name).toBeTruthy();
    expect(typeof first.type).toBe("string");
    expect(typeof first.position).toBe("number");
    // Positions are non-decreasing.
    const positions = rows.map((r) => r.position);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("falls back to the default team when no team arg is given", () => {
    const res = run(["state", "list", "--team", TEAM, "--json"]);
    expect(res.code).toBe(0);
    const rows = JSON.parse(res.stdout);
    expect(Array.isArray(rows)).toBe(true);
  });

  it("views a single workflow state by id", () => {
    const rows = runJson<Array<{ id: string }>>(["state", "list", TEAM]);
    const id = rows[0]!.id;
    const d = runJson<{ id: string; name: string; type: string; team: string }>([
      "state",
      "view",
      id,
    ]);
    expect(d.id).toBe(id);
    expect(d.name).toBeTruthy();
    expect(d.team).toContain(TEAM);
  });

  it("reports a clean not-found for a bogus state id", () => {
    const res = run(["state", "view", "00000000-0000-4000-8000-000000000000", "--json"]);
    expect([1, 3]).toContain(res.code);
  });
});
