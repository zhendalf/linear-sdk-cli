import { describe, it, expect, beforeAll } from "bun:test";
import { runJson, LIVE, ensureBuilt } from "./_helpers.js";

const suite = LIVE ? describe : describe.skip;

suite("organization — read-only (live)", () => {
  beforeAll(() => ensureBuilt());

  it("views the workspace with name, urlKey, and userCount", () => {
    const d = runJson<{ id: string; name: string; urlKey: string; userCount: number }>([
      "organization",
      "view",
    ]);
    expect(typeof d.name).toBe("string");
    expect(typeof d.urlKey).toBe("string");
    expect(d.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof d.userCount).toBe("number");
  });

  it("is reachable via the 'org' alias and default subcommand", () => {
    const d = runJson<{ name: string }>(["org"]);
    expect(typeof d.name).toBe("string");
  });

  it("lists workspace members with the required columns", () => {
    const rows = runJson<
      Array<{ displayName: string; email: string; admin: boolean; active: boolean }>
    >(["organization", "members"]);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("email");
    expect(typeof rows[0]!.admin).toBe("boolean");
    expect(typeof rows[0]!.active).toBe("boolean");
  });

  it("lists organization invites (tolerating an empty workspace)", () => {
    const rows = runJson<Array<{ email: string; status: string }>>([
      "organization",
      "invites",
    ]);
    expect(Array.isArray(rows)).toBe(true);
    // Invites may be empty on the test workspace; only assert shape when present.
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty("email");
      expect(typeof rows[0]!.status).toBe("string");
    }
  });
});
