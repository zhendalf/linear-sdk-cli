import { describe, it, expect, beforeAll } from "bun:test";
import { run, runJson, LIVE, ensureBuilt } from "./_helpers.js";

const suite = LIVE ? describe : describe.skip;

suite("phase 0 — auth, whoami, api (live)", () => {
  beforeAll(() => ensureBuilt());

  it("whoami --json returns the viewer + organization", () => {
    const me = runJson<{ id: string; email: string; organization: { urlKey: string } }>([
      "whoami",
    ]);
    expect(me.id).toBeTruthy();
    expect(me.email).toContain("@");
    expect(me.organization.urlKey).toBeTruthy();
  });

  it("auth status reports an env/flag/user source", () => {
    const status = runJson<{ authenticated: boolean; source: string }>(["auth", "status"]);
    expect(status.authenticated).toBe(true);
    expect(["env", "flag", "user"]).toContain(status.source);
  });

  it("config redacts the API key", () => {
    const cfg = runJson<{ apiKey: string }>(["config"]);
    expect(cfg.apiKey).toContain("••••");
    expect(cfg.apiKey).not.toMatch(/lin_api_[A-Za-z0-9]{20,}/);
  });

  it("api runs a raw query", () => {
    const data = runJson<{ viewer: { id: string } }>(["api", "{ viewer { id } }"]);
    expect(data.viewer.id).toBeTruthy();
  });

  it("api with variables", () => {
    const data = runJson<{ teams: { nodes: Array<{ key: string }> } }>([
      "api",
      "query($n:Int){ teams(first:$n){ nodes { key } } }",
      "--vars",
      '{"n":5}',
    ]);
    expect(Array.isArray(data.teams.nodes)).toBe(true);
  });

  it("surfaces a JSON error envelope on a bad query", () => {
    const res = run(["api", "{ thisFieldDoesNotExist }", "--json"]);
    expect(res.code).not.toBe(0);
    const err = JSON.parse(res.stderr);
    expect(err.error).toBeTruthy();
    expect(err.error.message).toBeTruthy();
  });
});
