/**
 * The `auth` commands against an isolated config directory and a fake keyring.
 * `auth login` is exercised live (test/integration/auth.test.ts) because it
 * validates the key against the API; everything else needs no network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createProgram } from "../../src/cli.js";
import {
  userConfigPath,
  referenceCredentialsPath,
  writeOAuthCredential,
} from "../../src/config.js";
import { memoryKeyring, setKeyringBackend } from "../../src/lib/keyring.js";
import { setAuthValidationClientFactoryForTests } from "../../src/commands/meta.js";
import type { OAuthUserCredential } from "../../src/oauth.js";

const nativeFetch = globalThis.fetch;

let root: string;
let kr: ReturnType<typeof memoryKeyring>;
let savedXdg: string | undefined;
let savedHome: string | undefined;
let savedCwd: string;
let savedApiKey: string | undefined;
let savedApiToken: string | undefined;
let savedAccessToken: string | undefined;
let savedWorkspace: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "linauth-"));
  mkdirSync(join(root, "xdg", "linear"), { recursive: true });
  savedXdg = process.env.XDG_CONFIG_HOME;
  savedHome = process.env.HOME;
  savedCwd = process.cwd();
  savedApiKey = process.env.LINEAR_API_KEY;
  savedApiToken = process.env.LINEAR_API_TOKEN;
  savedAccessToken = process.env.LINEAR_ACCESS_TOKEN;
  savedWorkspace = process.env.LINEAR_WORKSPACE;
  process.env.XDG_CONFIG_HOME = join(root, "xdg");
  process.env.HOME = root;
  process.chdir(root);
  // Credential resolution must come only from the temp config/keyring below,
  // never from an ambient LINEAR_API_KEY (e.g. set in a dev/CI environment).
  delete process.env.LINEAR_API_KEY;
  delete process.env.LINEAR_API_TOKEN;
  delete process.env.LINEAR_ACCESS_TOKEN;
  delete process.env.LINEAR_WORKSPACE;
  kr = memoryKeyring();
  setKeyringBackend(kr);
});

afterEach(() => {
  vi.restoreAllMocks();
  setAuthValidationClientFactoryForTests(undefined);
  setKeyringBackend(undefined);
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = savedXdg;
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedApiKey === undefined) delete process.env.LINEAR_API_KEY;
  else process.env.LINEAR_API_KEY = savedApiKey;
  if (savedApiToken === undefined) delete process.env.LINEAR_API_TOKEN;
  else process.env.LINEAR_API_TOKEN = savedApiToken;
  if (savedAccessToken === undefined) delete process.env.LINEAR_ACCESS_TOKEN;
  else process.env.LINEAR_ACCESS_TOKEN = savedAccessToken;
  if (savedWorkspace === undefined) delete process.env.LINEAR_WORKSPACE;
  else process.env.LINEAR_WORKSPACE = savedWorkspace;
  process.chdir(savedCwd);
  rmSync(root, { recursive: true, force: true });
});

async function runJson(args: string[]): Promise<any> {
  let out = "";
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: any) => {
    out += c;
    return true;
  });
  try {
    await createProgram().parseAsync(["node", "linear", ...args, "--json"]);
  } finally {
    spy.mockRestore();
  }
  return JSON.parse(out);
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function eventually<T>(read: () => T | undefined): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("Timed out waiting for test output");
}

describe("auth status", () => {
  it("reports an ephemeral OAuth access token without a workspace profile", async () => {
    process.env.LINEAR_ACCESS_TOKEN = "oauth_access_abcdefgh1234";
    const st = await runJson(["auth", "status"]);
    expect(st).toMatchObject({
      authenticated: true,
      credentialType: "oauth-access-token",
      source: "env",
      workspace: null,
      key: "oaut••••1234",
    });
  });

  it("reports Source: keychain for a keyring-backed workspace", async () => {
    writeFileSync(userConfigPath(), `[workspaces."acme"]\nkeyring = true\n`);
    kr.store.set("acme", "lin_api_fromkeychain0000");
    const st = await runJson(["auth", "status"]);
    expect(st).toMatchObject({
      authenticated: true,
      source: "keychain",
      workspace: "acme",
      key: "lin_api_••••0000",
      keyring: "keychain",
    });
  });

  it("is authenticated straight after a schpet/linear-cli install, with no config of ours", async () => {
    writeFileSync(referenceCredentialsPath(), `default = "lumiere"\nworkspaces = ["lumiere"]\n`);
    kr.store.set("lumiere", "lin_api_schpet0000000000");
    const st = await runJson(["auth", "status"]);
    expect(st).toMatchObject({ authenticated: true, source: "keychain", workspace: "lumiere" });
  });

  it("names the platform's keyring, and `null` where there is none", async () => {
    setKeyringBackend(null);
    const st = await runJson(["auth", "status"]);
    expect(st).toMatchObject({ authenticated: false, source: "none", keyring: null });
  });
});

describe("OAuth credentials stay invocation-scoped", () => {
  it("does not let auth login persist an OAuth access token", async () => {
    await expect(
      createProgram().parseAsync([
        "node",
        "linear",
        "auth",
        "login",
        "--access-token",
        "oauth_access_1234",
        "--json",
      ]),
    ).rejects.toThrow(/cannot persist an injected access token/);
    expect(existsSync(userConfigPath())).toBe(false);
    expect(kr.store.size).toBe(0);
  });

  it("does not re-export an injected OAuth token through auth token", async () => {
    process.env.LINEAR_ACCESS_TOKEN = "oauth_access_1234";
    await expect(
      createProgram().parseAsync(["node", "linear", "auth", "token", "--json"]),
    ).rejects.toThrow(/exports stored API keys only/);
  });
});

describe("browser OAuth login", () => {
  it("completes PKCE through the loopback, emits secret-safe JSON, and stores only in keyring", async () => {
    const port = await freePort();
    const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
    setAuthValidationClientFactoryForTests((_credential, kind) => {
      expect(kind).toBe("oauth-access-token");
      return {
        viewer: Promise.resolve({ id: "user-1", name: "Ada", email: "ada@example.com" }),
        organization: Promise.resolve({ id: "org-1", name: "Acme", urlKey: "acme" }),
      };
    });
    vi.spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
      expect(String(input)).toBe("https://api.linear.app/oauth/token");
      const body = String(init?.body);
      expect(body).toContain("code_verifier=");
      expect(body).not.toContain("client_secret");
      return Response.json({
        access_token: "access-secret",
        refresh_token: "refresh-secret",
        expires_in: 3600,
        scope: "read write",
        token_type: "Bearer",
      });
    }) as typeof fetch);

    let out = "";
    let err = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
      out += chunk;
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => {
      err += chunk;
      return true;
    });
    const login = createProgram().parseAsync([
      "node",
      "linear",
      "auth",
      "login",
      "--no-browser",
      "--client-id",
      "public-client",
      "--redirect-uri",
      redirectUri,
      "--timeout",
      "2",
      "--json",
    ]);
    const authorizationUrl = await eventually(
      () => err.match(/https:\/\/linear\.app\/oauth\/authorize\?\S+/)?.[0],
    );
    const state = new URL(authorizationUrl).searchParams.get("state");
    expect(state).toBeTruthy();
    await nativeFetch(`${redirectUri}?code=authorization-code&state=${encodeURIComponent(state!)}`);
    await login;

    const receipt = JSON.parse(out);
    expect(receipt).toMatchObject({
      success: true,
      credentialType: "oauth-user",
      workspace: "acme",
      storage: "keychain",
      scopes: ["read", "write"],
    });
    expect(out).not.toContain("access-secret");
    expect(out).not.toContain("refresh-secret");
    expect(err).not.toContain("access-secret");
    expect(readFileSync(userConfigPath(), "utf8")).not.toContain("secret");
    expect(kr.store.get("oauth:acme")).toContain("refresh-secret");
  });
});

describe("auth list", () => {
  it("shows where each credential's secret lives", async () => {
    writeFileSync(
      userConfigPath(),
      `default_workspace = "pt"\n[workspaces."pt"]\napi_key = "lin_api_pt0000000000"\n[workspaces."kc"]\nkeyring = true\n`,
    );
    const list = await runJson(["auth", "list"]);
    expect(list).toEqual([
      { slug: "pt", isDefault: true, storage: "file", credentialType: "api-key" },
      { slug: "kc", isDefault: false, storage: "keychain", credentialType: "api-key" },
    ]);
  });
});

describe("auth migrate", () => {
  it("moves plaintext keys into the keyring; the file keeps only markers, and status flips", async () => {
    writeFileSync(
      userConfigPath(),
      `default_workspace = "a"\n[workspaces."a"]\napi_key = "lin_api_a00000000000"\n[workspaces."b"]\napi_key = "lin_api_b00000000000"\n`,
    );
    expect((await runJson(["auth", "status"])).source).toBe("user");
    const res = await runJson(["auth", "migrate"]);
    expect(res).toMatchObject({ success: true, migrated: ["a", "b"] });
    expect(kr.store.get("a")).toBe("lin_api_a00000000000");
    expect(kr.store.get("b")).toBe("lin_api_b00000000000");
    expect(readFileSync(userConfigPath(), "utf8")).not.toContain("lin_api_");
    expect(await runJson(["auth", "status"])).toMatchObject({ source: "keychain", workspace: "a" });
    // Idempotent.
    expect((await runJson(["auth", "migrate"])).migrated).toEqual([]);
  });

  it("errors, keeping the file, where there is no keyring", async () => {
    setKeyringBackend(null);
    writeFileSync(userConfigPath(), `[workspaces."a"]\napi_key = "lin_api_a00000000000"\n`);
    // Errors propagate to the bin's boundary, which maps them to an exit code.
    await expect(
      createProgram().parseAsync(["node", "linear", "auth", "migrate", "--json"]),
    ).rejects.toThrow(/No system keyring/);
    expect(readFileSync(userConfigPath(), "utf8")).toContain("lin_api_a00000000000");
  });
});

describe("auth logout", () => {
  it("revokes a stored OAuth refresh token before removing the local profile", async () => {
    const credential: OAuthUserCredential = {
      version: 1,
      kind: "oauth-user",
      actor: "user",
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      expiresAt: Date.now() + 3_600_000,
      scopes: ["read", "write"],
      tokenType: "Bearer",
      clientId: "public-client",
      workspace: { id: "org-1", name: "Acme", urlKey: "acme" },
      user: { id: "user-1", name: "Ada", email: "ada@example.com" },
    };
    writeOAuthCredential(credential);
    let requestBody = "";
    vi.spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
      expect(String(input)).toBe("https://api.linear.app/oauth/revoke");
      requestBody = String(init?.body);
      return new Response(null, { status: 200 });
    }) as typeof fetch);
    const out = await runJson(["auth", "logout", "--yes"]);
    expect(out).toMatchObject({
      success: true,
      workspace: "acme",
      removed: true,
      revocation: "revoked",
    });
    expect(requestBody).toContain("token=refresh-secret");
    expect(requestBody).toContain("token_type_hint=refresh_token");
    expect(kr.store.has("oauth:acme")).toBe(false);
  });

  it("removes the keyring entry and the workspace table", async () => {
    writeFileSync(userConfigPath(), `[workspaces."acme"]\nkeyring = true\n`);
    kr.store.set("acme", "lin_api_fromkeychain0000");
    const out = await runJson(["auth", "logout", "--yes"]);
    expect(out).toMatchObject({ success: true, workspace: "acme", removed: true });
    expect(kr.store.has("acme")).toBe(false);
    expect(await runJson(["auth", "list"])).toEqual([]);
  });

  it("can forget a workspace only the reference CLI's list knows", async () => {
    writeFileSync(referenceCredentialsPath(), `default = "lumiere"\nworkspaces = ["lumiere"]\n`);
    kr.store.set("lumiere", "lin_api_schpet0000000000");
    const out = await runJson(["auth", "logout", "--workspace", "lumiere", "--yes"]);
    expect(out).toMatchObject({ success: true, removed: true });
    expect(kr.store.has("lumiere")).toBe(false);
    expect(readFileSync(referenceCredentialsPath(), "utf8").trim()).toBe("workspaces = []");
    expect((await runJson(["auth", "status"])).authenticated).toBe(false);
  });
});
