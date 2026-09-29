import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import {
  existsSync,
  statSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createProgram } from "../../src/cli.js";
import { userConfigPath, resolveConfig, writeCredential } from "../../src/config.js";
import { setAuthValidationClientFactoryForTests } from "../../src/commands/meta.js";
import { memoryKeyring, setKeyringBackend } from "../../src/lib/keyring.js";

const bin = resolve(import.meta.dir, "../../src/bin/linear.ts");
const envKeys = [
  "HOME",
  "XDG_CONFIG_HOME",
  "LINEAR_API_KEY",
  "LINEAR_API_TOKEN",
  "LINEAR_ACCESS_TOKEN",
  "LINEAR_WORKSPACE",
  "LINEAR_CLIENT_ID",
  "LINEAR_CLIENT_SECRET",
  "LINEAR_CLIENT_SCOPES",
];
let savedEnv: Record<string, string | undefined>;
let root: string;
let cwd: string;

beforeEach(() => {
  savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  root = realpathSync(mkdtempSync(join(tmpdir(), "lin-auth-contract-")));
  cwd = process.cwd();
  process.chdir(root);
  process.env.HOME = root;
  process.env.XDG_CONFIG_HOME = join(root, "xdg");
  mkdirSync(join(root, "xdg", "linear"), { recursive: true });
  setKeyringBackend(memoryKeyring());
  setAuthValidationClientFactoryForTests(() => ({
    viewer: Promise.resolve({ id: "u", name: "Ada", email: "ada@example.com" }),
    organization: Promise.resolve({ id: "o", name: "Acme", urlKey: "acme" }),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  setAuthValidationClientFactoryForTests(undefined);
  setKeyringBackend(undefined);
  process.chdir(cwd);
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  rmSync(root, { recursive: true, force: true });
});

async function run(args: string[]) {
  let stdout = "";
  let stderr = "";
  const out = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
    stdout += chunk;
    return true;
  });
  const err = vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => {
    stderr += chunk;
    return true;
  });
  try {
    await createProgram().parseAsync(["node", "linear", ...args]);
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
  return { stdout, stderr };
}

describe("auth workspace output contract", () => {
  it("reports the project association in secret-safe JSON and human output", async () => {
    const result = await run(["auth", "login", "--key", "lin_api_secret", "--json"]);
    expect(JSON.parse(result.stdout)).toMatchObject({
      success: true,
      workspace: "acme",
      projectConfigPath: join(root, ".linear.toml"),
    });
    expect(result.stdout + result.stderr).not.toContain("lin_api_secret");
    expect(readFileSync(join(root, ".linear.toml"), "utf8")).toBe('workspace = "acme"\n');
    const human = await run(["auth", "login", "--key", "lin_api_secret"]);
    expect(human.stdout + human.stderr).toContain(
      `Project workspace saved to ${join(root, ".linear.toml")}`,
    );
    const skipped = await run([
      "auth",
      "login",
      "--key",
      "lin_api_secret",
      "--no-project",
      "--json",
    ]);
    expect(JSON.parse(skipped.stdout).projectConfigPath).toBeNull();
  });

  it("advertises the nullable association path in command introspection", async () => {
    const result = await run(["commands", "auth", "login", "--json"]);
    expect(JSON.parse(result.stdout).output.fields.projectConfigPath).toBe("string|null");
  });

  for (const command of [["whoami"], ["auth", "token"], ["auth", "status"]]) {
    it(`${command.join(" ")} fails with a parseable JSON error when selection is ambiguous`, () => {
      writeFileSync(
        userConfigPath(),
        '[workspaces.a]\napi_key = "lin_api_a"\n[workspaces.b]\napi_key = "lin_api_b"\n',
      );
      const result = spawnSync("bun", ["--no-env-file", bin, ...command, "--json"], {
        cwd: root,
        env: process.env,
        encoding: "utf8",
      });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      const envelope = JSON.parse(result.stderr);
      expect(JSON.stringify(envelope)).toContain("none is selected");
      expect(JSON.stringify(envelope)).toContain("--workspace");
      expect(result.stdout + result.stderr).not.toContain("lin_api_");
    });
  }
});

describe("persistent app identity", () => {
  it("stores only in keyring, survives fresh config resolution, and reports secret-safe status", async () => {
    const savedFetch = globalThis.fetch;
    let exchanges = 0;
    globalThis.fetch = (async () => {
      exchanges++;
      return Response.json({
        access_token: "app-access-secret",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "read write",
      });
    }) as unknown as typeof fetch;
    try {
      writeCredential("acme", "lin_api_existing_secret");
      const login = await run([
        "auth",
        "login",
        "--app",
        "--client-id",
        "app-id",
        "--client-secret",
        "app-client-secret",
        "--json",
      ]);
      expect(JSON.parse(login.stdout)).toMatchObject({
        success: true,
        credentialType: "oauth-app",
        storage: "keychain",
        workspace: "acme",
      });
      const configText = readFileSync(userConfigPath(), "utf8");
      expect(configText).toContain("app = true");
      for (const secret of ["app-client-secret", "app-access-secret"]) {
        expect(configText + login.stdout + login.stderr).not.toContain(secret);
      }
      const fresh = resolveConfig({
        cwd: root,
        env: { HOME: root, XDG_CONFIG_HOME: join(root, "xdg") },
      });
      expect(fresh.appCredential?.clientSecret).toBe("app-client-secret");
      expect(fresh.accessToken).toBeUndefined();
      const status = await run(["auth", "status", "--json"]);
      expect(JSON.parse(status.stdout)).toMatchObject({
        authenticated: true,
        credentialType: "oauth-app",
        source: "keychain",
        scopeVisibility: "known",
        scopes: ["read", "write"],
        expiresAt: null,
      });
      expect(exchanges).toBe(1);
      expect(status.stdout + status.stderr).not.toContain("app-client-secret");
      const logout = await run(["auth", "logout", "--workspace", "acme", "--yes", "--json"]);
      expect(JSON.parse(logout.stdout)).toMatchObject({
        removed: true,
        revocation: "skipped",
        fallbackCredentialType: "api-key",
      });
      const after = resolveConfig({
        cwd: root,
        env: { HOME: root, XDG_CONFIG_HOME: join(root, "xdg") },
      });
      expect(after.appCredential).toBeUndefined();
      expect(after.apiKey).toBe("lin_api_existing_secret");
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("refuses admin scopes and secret options without explicit app identity", async () => {
    for (const args of [
      ["--app", "--admin"],
      ["--client-credentials", "--scope", "read,admin"],
      ["--client-credentials", "--scope", "read,,write"],
      ["--client-credentials", "--read-only", "--scope", "read"],
      ["--client-secret", "secret"],
    ]) {
      await expect(run(["auth", "login", ...args, "--json"])).rejects.toThrow();
    }
    expect(() => readFileSync(userConfigPath(), "utf8")).toThrow();
  });

  it("requires keyring and never falls back to plaintext", async () => {
    setKeyringBackend(null);
    await expect(
      run(["auth", "login", "--app", "--client-id", "id", "--client-secret", "secret", "--json"]),
    ).rejects.toThrow(/keyring/);
    expect(() => readFileSync(userConfigPath(), "utf8")).toThrow();
  });

  it("does not store credentials when Linear rejects the exchange", async () => {
    const savedFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({ error: "app-client-secret" }, { status: 401 })) as unknown as typeof fetch;
    try {
      await expect(
        run([
          "auth",
          "login",
          "--app",
          "--client-id",
          "id",
          "--client-secret",
          "app-client-secret",
          "--json",
        ]),
      ).rejects.toThrow(/HTTP 401/);
      expect(() => readFileSync(userConfigPath(), "utf8")).toThrow();
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});

describe("headless app CLI contracts", () => {
  function mockNetwork(reject = false) {
    const path = join(root, "mock-network.ts");
    writeFileSync(
      path,
      `globalThis.fetch = async (input, init) => {
      if (String(input).endsWith("/oauth/token")) {
        if (${reject}) return Response.json({ error: "contract-client-secret contract-access-token" }, { status: 401 });
        if (new Headers(init?.headers).get("Authorization") !== "Basic " + Buffer.from("app-id:contract-client-secret").toString("base64")) throw new Error("Invalid token request");
        return Response.json({ access_token: "contract-access-token", expires_in: 3600, token_type: "Bearer", scope: "read write" });
      }
      if (new Headers(init?.headers).get("Authorization") !== "Bearer contract-access-token") throw new Error("Invalid GraphQL request");
      return Response.json({ data: {
        viewer: { id: "app-user", name: "Lumos", email: "app@example.com" },
        organization: { id: "org", name: "Acme", urlKey: "acme", projectStatuses: [] },
        issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }
      } });
    };`,
    );
    return path;
  }

  function child(
    args: string[],
    options: { input?: string; env?: Record<string, string>; reject?: boolean } = {},
  ) {
    return spawnSync(
      "bun",
      ["--no-env-file", "--preload", mockNetwork(options.reject), bin, ...args],
      {
        cwd: root,
        env: { ...process.env, ...options.env },
        input: options.input,
        encoding: "utf8",
      },
    );
  }

  it("signs in through stdin and authenticates fresh processes without exported tokens", async () => {
    const login = child(
      [
        "auth",
        "login",
        "--client-credentials",
        "--plaintext",
        "--client-id",
        "app-id",
        "--client-secret",
        "-",
        "--no-project",
        "--json",
      ],
      { input: "contract-client-secret\n" },
    );
    expect(login.stderr).toBe("");
    expect(login.status).toBe(0);
    expect(JSON.parse(login.stdout)).toMatchObject({
      success: true,
      credentialType: "oauth-app",
      storage: "file",
      workspace: "acme",
    });
    expect(login.stdout + login.stderr).not.toContain("contract-client-secret");
    expect(statSync(userConfigPath()).mode & 0o777).toBe(0o600);
    expect(statSync(join(root, "xdg", "linear")).mode & 0o777).toBe(0o700);
    const before = readFileSync(userConfigPath(), "utf8");
    expect(before).not.toContain("contract-access-token");
    const status = child(["auth", "status", "--json"]);
    expect(status.status).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({
      authenticated: true,
      source: "user",
      credentialType: "oauth-app",
      expiresAt: null,
    });
    const whoami = child(["whoami", "--json"]);
    expect(whoami.status).toBe(0);
    expect(whoami.stdout).toContain("Lumos");
    const concurrent = await Promise.all(
      Array.from({ length: 3 }, async () => {
        const proc = Bun.spawn(
          [
            "bun",
            "--no-env-file",
            "--preload",
            join(root, "mock-network.ts"),
            bin,
            "issue",
            "list",
            "--limit",
            "1",
            "--json",
            "--quiet",
          ],
          { cwd: root, env: process.env, stdout: "pipe", stderr: "pipe" },
        );
        const [stdout, stderr, code] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        return { stdout, stderr, code };
      }),
    );
    for (const result of concurrent) {
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([]);
      expect(result.stdout + result.stderr).not.toMatch(
        /contract-client-secret|contract-access-token/,
      );
    }
    expect(readFileSync(userConfigPath(), "utf8")).toBe(before);
    const token = child(["auth", "token", "--json"]);
    expect(token.status).toBe(2);
    expect(token.stdout + token.stderr).not.toMatch(/contract-client-secret|contract-access-token/);
    const logout = child(["auth", "logout", "--workspace", "acme", "--yes", "--json"]);
    expect(logout.status).toBe(0);
    expect(readFileSync(userConfigPath(), "utf8")).not.toContain("contract-client-secret");
    expect(JSON.parse(child(["auth", "status", "--json"]).stdout).authenticated).toBe(false);
  });

  it("environment-only auth writes no credential or token cache and redacts debug failures", () => {
    const env = { LINEAR_CLIENT_ID: "app-id", LINEAR_CLIENT_SECRET: "contract-client-secret" };
    const whoami = child(["whoami", "--json"], { env });
    expect(whoami.stderr).toBe("");
    expect(whoami.status).toBe(0);
    expect(whoami.stdout).toContain("Lumos");
    expect(existsSync(userConfigPath())).toBe(false);
    expect(existsSync(join(root, ".cache", "linear-sdk-cli"))).toBe(false);
    const status = child(["auth", "status", "--json"], { env });
    expect(JSON.parse(status.stdout)).toMatchObject({
      authenticated: true,
      source: "env",
      credentialType: "oauth-app",
    });
    const failed = child(["whoami", "--json", "--debug"], { env, reject: true });
    expect(failed.status).toBe(4);
    expect(failed.stdout).toBe("");
    expect(JSON.parse(failed.stderr).error.code).toBe("auth");
    expect(failed.stderr).not.toMatch(/contract-client-secret|contract-access-token/);
    expect(existsSync(userConfigPath())).toBe(false);
  });

  it("explicit login accepts environment credentials and custom scopes", async () => {
    process.env.LINEAR_CLIENT_ID = "app-id";
    process.env.LINEAR_CLIENT_SECRET = "contract-client-secret";
    const savedFetch = globalThis.fetch;
    let body = "";
    globalThis.fetch = (async (_input, init) => {
      body = String(init?.body);
      return Response.json({
        access_token: "contract-access-token",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "read comments:create",
      });
    }) as typeof fetch;
    try {
      const login = await run([
        "auth",
        "login",
        "--client-credentials",
        "--plaintext",
        "--scope",
        "read,comments:create",
        "--no-project",
        "--json",
      ]);
      expect(JSON.parse(login.stdout).storage).toBe("file");
      expect(body).toContain("scope=read%2Ccomments%3Acreate");
      expect(login.stdout + login.stderr).not.toContain("contract-client-secret");
      delete process.env.LINEAR_CLIENT_ID;
      delete process.env.LINEAR_CLIENT_SECRET;
      expect(JSON.parse((await run(["auth", "status", "--json"])).stdout).scopes).toEqual([
        "read",
        "comments:create",
      ]);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});
