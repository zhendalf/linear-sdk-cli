import { describe, it, expect, beforeAll } from "bun:test";
import { run, runJson, LIVE, ensureBuilt } from "./_helpers.js";

const suite = LIVE ? describe : describe.skip;

suite("user read (live)", () => {
  beforeAll(() => ensureBuilt());

  it("lists workspace users with the expected columns", () => {
    const rows = runJson<Array<{ displayName: string; email: string; active: boolean; admin: boolean }>>([
      "user",
      "list",
    ]);
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length) {
      expect(typeof rows[0]!.displayName).toBe("string");
      expect(typeof rows[0]!.email).toBe("string");
      expect(typeof rows[0]!.active).toBe("boolean");
    }
  });

  it("shows the authenticated viewer via `me`", () => {
    const d = runJson<{ id: string; email: string; isMe: boolean }>(["user", "me"]);
    expect(d.id).toBeTruthy();
    expect(d.email).toContain("@");
    expect(d.isMe).toBe(true);
  });

  it("views the viewer via `view me` (alias of me)", () => {
    const me = runJson<{ id: string; email: string }>(["user", "me"]);
    const d = runJson<{ id: string; email: string }>(["user", "view", "me"]);
    expect(d.id).toBe(me.id);
    expect(d.email).toBe(me.email);
  });

  it("resolves a user by email to the same record", () => {
    const me = runJson<{ id: string; email: string }>(["user", "me"]);
    const d = runJson<{ id: string }>(["user", "view", me.email]);
    expect(d.id).toBe(me.id);
  });

  it("views a user by id", () => {
    const me = runJson<{ id: string }>(["user", "me"]);
    const d = runJson<{ id: string }>(["user", "view", me.id]);
    expect(d.id).toBe(me.id);
  });

  it("returns a clean not_found for an unknown user", () => {
    const res = run(["user", "view", "nobody@nonexistent.invalid", "--json"]);
    expect(res.code).toBe(3);
    expect(JSON.parse(res.stderr).error.code).toBe("not_found");
  });
});
