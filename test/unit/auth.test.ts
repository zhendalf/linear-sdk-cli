/**
 * The `auth` commands against an isolated config directory and a fake keyring.
 * `auth login` is exercised live (test/integration/auth.test.ts) because it
 * validates the key against the API; everything else needs no network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProgram } from "../../src/cli.js";
import { userConfigPath, referenceCredentialsPath } from "../../src/config.js";
import { memoryKeyring, setKeyringBackend } from "../../src/lib/keyring.js";

let root: string;
let kr: ReturnType<typeof memoryKeyring>;
let savedXdg: string | undefined;
let savedHome: string | undefined;
let savedCwd: string;
let savedApiKey: string | undefined;
let savedApiToken: string | undefined;
let savedWorkspace: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "linauth-"));
  mkdirSync(join(root, "xdg", "linear"), { recursive: true });
  savedXdg = process.env.XDG_CONFIG_HOME;
  savedHome = process.env.HOME;
  savedCwd = process.cwd();
  savedApiKey = process.env.LINEAR_API_KEY;
  savedApiToken = process.env.LINEAR_API_TOKEN;
  savedWorkspace = process.env.LINEAR_WORKSPACE;
  process.env.XDG_CONFIG_HOME = join(root, "xdg");
  process.env.HOME = root;
  process.chdir(root);
  // Credential resolution must come only from the temp config/keyring below,
  // never from an ambient LINEAR_API_KEY (e.g. set in a dev/CI environment).
  delete process.env.LINEAR_API_KEY;
  delete process.env.LINEAR_API_TOKEN;
  delete process.env.LINEAR_WORKSPACE;
  kr = memoryKeyring();
  setKeyringBackend(kr);
});

afterEach(() => {
  vi.restoreAllMocks();
  setKeyringBackend(undefined);
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = savedXdg;
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedApiKey === undefined) delete process.env.LINEAR_API_KEY;
  else process.env.LINEAR_API_KEY = savedApiKey;
  if (savedApiToken === undefined) delete process.env.LINEAR_API_TOKEN;
  else process.env.LINEAR_API_TOKEN = savedApiToken;
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

describe("auth status", () => {
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

describe("auth list", () => {
  it("shows where each credential's secret lives", async () => {
    writeFileSync(
      userConfigPath(),
      `default_workspace = "pt"\n[workspaces."pt"]\napi_key = "lin_api_pt0000000000"\n[workspaces."kc"]\nkeyring = true\n`,
    );
    const list = await runJson(["auth", "list"]);
    expect(list).toEqual([
      { slug: "pt", isDefault: true, storage: "file" },
      { slug: "kc", isDefault: false, storage: "keychain" },
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
