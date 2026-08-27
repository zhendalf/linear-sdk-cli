import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("browser OAuth CLI contracts", () => {
  let home: string;

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), "linoauth-contract-"));
  });

  afterAll(() => rmSync(home, { recursive: true, force: true }));

  function run(args: string[], extraEnv: Record<string, string> = {}) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...extraEnv,
      HOME: home,
      XDG_CONFIG_HOME: home,
    };
    delete env.LINEAR_API_KEY;
    delete env.LINEAR_API_TOKEN;
    delete env.LINEAR_ACCESS_TOKEN;
    delete env.LINEAR_WORKSPACE;
    return spawnSync(
      "bun",
      ["--no-env-file", "src/bin/linear.ts", "--json", "auth", "login", ...args],
      { cwd: join(import.meta.dir, "../.."), env, encoding: "utf8" },
    );
  }

  it("emits one stable JSON error and no stdout for an invalid loopback callback", () => {
    const result = run([
      "--no-browser",
      "--client-id",
      "public-client",
      "--redirect-uri",
      "https://example.com/callback",
    ]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        message:
          "OAuth redirect URI must be an HTTP loopback URL with an explicit port and no query or fragment.",
        code: "usage",
      },
    });
  });

  it("never repeats an injected access token in the JSON diagnostic", () => {
    const secret = "lin_oauth_contract_secret_that_must_not_escape";
    const result = run(["--access-token", secret]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(() => JSON.parse(result.stderr)).not.toThrow();
    expect(result.stderr).not.toContain(secret);
    expect(JSON.parse(result.stderr).error.code).toBe("usage");
  });
});
