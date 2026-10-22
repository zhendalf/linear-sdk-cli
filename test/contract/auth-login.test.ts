import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const bin = resolve(import.meta.dir, "../../src/bin/linear.ts");
let home: string;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "lin-login-contract-")));
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

function run(
  args: string[],
  options: { input?: string; env?: Record<string, string>; credential?: string } = {},
) {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, XDG_CONFIG_HOME: home };
  for (const key of Object.keys(env)) {
    if (key.startsWith("LINEAR_")) delete env[key];
  }
  Object.assign(env, options.env);
  const preload = join(home, "network.ts");
  writeFileSync(
    preload,
    `globalThis.fetch = async (input, init) => {
      if (String(input) !== "https://api.linear.app/graphql") throw new Error("Unexpected OAuth request");
      const header = new Headers(init?.headers).get("Authorization");
      if (header !== ${JSON.stringify(options.credential ?? "lin_api_stdin_secret")}) {
        return Response.json({ errors: [{ message: "Authentication required", extensions: { type: "authentication error" } }] }, { status: 401 });
      }
      return Response.json({ data: {
        viewer: { id: "user", name: "Ada", email: "ada@example.com", admin: false },
        organization: { id: "org", name: "Acme", urlKey: "acme", projectStatuses: [] }
      } });
    };`,
  );
  return spawnSync("bun", ["--no-env-file", "--preload", preload, bin, ...args], {
    cwd: home,
    env,
    input: options.input,
    encoding: "utf8",
    timeout: 5000,
  });
}

describe("API-key login CLI contracts", () => {
  it("advertises personal and app login without browser callback options", () => {
    const result = run(["commands", "auth", "login", "--json"]);
    expect(result.status, result.stderr).toBe(0);
    const command = JSON.parse(result.stdout);
    expect(command.description).toContain("personal API key (default)");
    const options = command.options.map((option: { attribute: string }) => option.attribute);
    expect(options).toContain("key");
    expect(options).toContain("app");
    expect(options).toContain("accessToken");
    for (const removed of ["browser", "redirectUri", "timeout", "admin"]) {
      expect(options).not.toContain(removed);
    }
  });

  it("fails immediately with a parseable JSON error when no key is supplied", () => {
    const result = run(["auth", "login", "--json"]);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        message:
          "Personal API-key login requires interactive input. Pipe a key to `linear auth login --key -`, or use --app for app credentials. To authenticate commands without saving credentials, set LINEAR_API_KEY or LINEAR_ACCESS_TOKEN.",
        code: "usage",
      },
    });
    expect(existsSync(join(home, "linear", "config.toml"))).toBe(false);
    expect(existsSync(join(home, ".linear.toml"))).toBe(false);
  });

  for (const flags of [[], ["--no-input"]]) {
    it(`does not prompt or consume implicit stdin with ${flags.join(" ") || "redirected input"}`, () => {
      const result = run(["auth", "login", ...flags], { input: "lin_api_stdin_secret\n" });
      expect(result.status, result.stderr).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("--key -");
      expect(result.stderr).not.toContain("lin_api_stdin_secret");
      expect(existsSync(join(home, "linear", "config.toml"))).toBe(false);
    });
  }

  it("validates stdin with API-key authorization, emits secret-safe JSON, and persists it", () => {
    const result = run(["auth", "login", "--key", "-", "--plaintext", "--json"], {
      input: " lin_api_stdin_secret \n",
    });
    expect(result.status, result.stderr).toBe(0);
    const receipt = JSON.parse(result.stdout);
    expect(receipt).toMatchObject({
      success: true,
      credentialType: "api-key",
      storage: "file",
      workspace: "acme",
      projectConfigPath: join(home, ".linear.toml"),
    });
    expect(result.stdout + result.stderr).not.toContain("lin_api_stdin_secret");
    expect(result.stderr).toBe("");
    expect(statSync(receipt.path).mode & 0o777).toBe(0o600);
    expect(readFileSync(receipt.path, "utf8")).toContain("lin_api_stdin_secret");
    const whoami = run(["whoami", "--json"]);
    expect(whoami.status).toBe(0);
    expect(JSON.parse(whoami.stdout).organization.urlKey).toBe("acme");
  });

  it("rejects an invalid key without exposing or saving it", () => {
    const result = run(["auth", "login", "--key", "-", "--plaintext", "--json"], {
      input: "lin_api_rejected_secret\n",
    });
    expect(result.status, result.stderr).toBe(4);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error.code).toBe("auth");
    expect(result.stderr).not.toContain("lin_api_rejected_secret");
    expect(existsSync(join(home, "linear", "config.toml"))).toBe(false);
  });

  it("rejects empty stdin without saving credentials", () => {
    const result = run(["auth", "login", "--key", "-", "--plaintext", "--json"], {
      input: " \n",
    });
    expect(result.status, result.stderr).toBe(2);
    expect(JSON.parse(result.stderr).error.message).toBe("No API key provided.");
    expect(existsSync(join(home, "linear", "config.toml"))).toBe(false);
  });

  it("requires explicit app mode for client IDs and scope options", () => {
    for (const flags of [["--client-id", "user-supplied-id"], ["--read-only"]]) {
      const result = run(["auth", "login", ...flags, "--json"]);
      expect(result.status, result.stderr).toBe(2);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr).error.message).toContain("require --app");
      expect(existsSync(join(home, "linear", "config.toml"))).toBe(false);
    }
  });

  it("never repeats an injected access token in the login diagnostic", () => {
    const secret = "lin_oauth_contract_secret_that_must_not_escape";
    const result = run(["auth", "login", "--access-token", secret, "--json"]);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error.message).toContain("cannot persist");
    expect(result.stderr).not.toContain(secret);
  });

  for (const source of ["flag", "env"] as const) {
    it(`keeps ${source} access tokens invocation-scoped with Bearer authorization`, () => {
      const secret = "injected-access-token";
      const result = run(
        ["whoami", "--json", ...(source === "flag" ? ["--access-token", secret] : [])],
        {
          credential: `Bearer ${secret}`,
          env: source === "env" ? { LINEAR_ACCESS_TOKEN: secret } : {},
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).organization.urlKey).toBe("acme");
      expect(result.stdout + result.stderr).not.toContain(secret);
      expect(existsSync(join(home, "linear", "config.toml"))).toBe(false);
      expect(existsSync(join(home, ".linear.toml"))).toBe(false);
    });
  }
});
