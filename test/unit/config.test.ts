import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  openSync,
  closeSync,
  statSync,
  chmodSync,
  readdirSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveConfig as resolveConfigImpl,
  redactKey,
  userConfigPath,
  writeCredential,
  adoptKeyringCredential,
  writeOAuthCredential,
  readOAuthCredential,
  rotateOAuthCredential,
  setDefaultWorkspace,
  setWorkspaceTeam,
  removeCredential,
  removeCredentialWithMetadata,
  removeOAuthCredential,
  listCredentials,
  migrateCredentials,
  referenceCredentialsPath,
  initProjectConfig,
  setConfigKey,
  assertSettableKey,
  defaultProjectConfigPath,
  SETTABLE_KEYS,
  type ConfigSource,
  type ConfigInputs,
} from "../../src/config.js";
import type { OAuthUserCredential } from "../../src/oauth.js";
import { execFileSync, spawn } from "node:child_process";
import {
  setKeyringBackend,
  memoryKeyring,
  KeyringError,
  type KeyringBackend,
} from "../../src/lib/keyring.js";
import { createClient } from "../../src/client.js";
import { readFileSync } from "node:fs";
import { parse as parseToml } from "smol-toml";

let root: string;
let xdg: string;
let projectDir: string;
/** A fake keyring for every test here, so nothing reaches the real Keychain. */
let kr: ReturnType<typeof memoryKeyring>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lincfg-"));
  xdg = join(root, "xdg");
  projectDir = join(root, "proj", "nested");
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(join(xdg, "linear"), { recursive: true });
  kr = memoryKeyring();
  setKeyringBackend(kr);
});

afterEach(() => {
  setKeyringBackend(undefined);
  rmSync(root, { recursive: true, force: true });
});

const baseEnv = (over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({
  XDG_CONFIG_HOME: xdg,
  HOME: root,
  ...over,
});

/** Keep cases without an explicit cwd inside the temporary fixture. */
function resolveConfig(inputs: ConfigInputs = {}) {
  return resolveConfigImpl({ cwd: root, ...inputs });
}

function writeUserConfig(body: string) {
  writeFileSync(userConfigPath(baseEnv()), body);
}

function writeProjectConfig(dir: string, body: string) {
  writeFileSync(join(dir, ".linear.toml"), body);
}

describe("resolveConfig precedence", () => {
  it("prefers flag over env over user config for the api key", () => {
    // The only configured workspace supplies the user-config key.
    writeUserConfig(`[workspaces."solo"]\napi_key = "lin_api_userkey0000"`);
    const env = baseEnv({ LINEAR_API_KEY: "lin_api_envkey00000" });
    expect(resolveConfig({ env, flags: { apiKey: "lin_api_flagkey0000" } }).apiKey).toBe(
      "lin_api_flagkey0000",
    );
    expect(resolveConfig({ env }).apiKey).toBe("lin_api_envkey00000");
    expect(resolveConfig({ env: baseEnv() }).apiKey).toBe("lin_api_userkey0000");
  });

  it("reports the api key source", () => {
    expect(resolveConfig({ env: baseEnv({ LINEAR_API_KEY: "x" }) }).apiKeySource).toBe("env");
    expect(resolveConfig({ env: baseEnv(), flags: { apiKey: "x" } }).apiKeySource).toBe("flag");
    expect(resolveConfig({ env: baseEnv() }).apiKeySource).toBe("none");
  });

  it("resolves an OAuth access token without treating it as an API key", () => {
    const cfg = resolveConfig({ env: baseEnv({ LINEAR_ACCESS_TOKEN: "oauth_access_1234" }) });
    expect(cfg).toMatchObject({
      accessToken: "oauth_access_1234",
      accessTokenSource: "env",
      apiKey: undefined,
      apiKeySource: "none",
      credentialWorkspace: undefined,
    });

    const client = createClient(cfg) as any;
    expect(client.options.headers.Authorization).toBe("Bearer oauth_access_1234");
  });

  it("lets an explicit credential flag override an ambient credential of the other kind", () => {
    const access = resolveConfig({
      env: baseEnv({ LINEAR_API_KEY: "lin_api_ambient0000" }),
      flags: { accessToken: "oauth_explicit" },
    });
    expect(access.accessToken).toBe("oauth_explicit");
    expect(access.apiKey).toBeUndefined();

    const apiKey = resolveConfig({
      env: baseEnv({ LINEAR_ACCESS_TOKEN: "oauth_ambient" }),
      flags: { apiKey: "lin_api_explicit0000" },
    });
    expect(apiKey.apiKey).toBe("lin_api_explicit0000");
    expect(apiKey.accessToken).toBeUndefined();
  });

  it("defers ambiguous same-precedence credentials until a client is needed", () => {
    const flags = resolveConfig({
      env: baseEnv(),
      flags: { apiKey: "lin_api_one", accessToken: "oauth_two" },
    });
    expect(flags.apiKey).toBeUndefined();
    expect(flags.accessToken).toBeUndefined();
    expect(() => createClient(flags)).toThrow(/only one of --api-key or --access-token/);

    const env = resolveConfig({
      env: baseEnv({ LINEAR_API_KEY: "lin_api_one", LINEAR_ACCESS_TOKEN: "oauth_two" }),
    });
    expect(() => createClient(env)).toThrow(/Both LINEAR_API_KEY\/LINEAR_API_TOKEN/);
  });

  it("NEVER reads the api key from a project .linear.toml", () => {
    writeProjectConfig(projectDir, `api_key = "lin_api_projectkey00"\nteam = "TES"`);
    const cfg = resolveConfig({ env: baseEnv(), cwd: projectDir });
    expect(cfg.apiKey).toBeUndefined();
    // but non-secret settings ARE read from the project file
    expect(cfg.team).toBe("TES");
  });

  it("walks ancestors to find the project config", () => {
    writeProjectConfig(join(root, "proj"), `team = "ENG"`);
    const cfg = resolveConfig({ env: baseEnv(), cwd: projectDir });
    expect(cfg.team).toBe("ENG");
    expect(cfg.projectConfigPath).toBe(join(root, "proj", ".linear.toml"));
  });

  it("env overrides project for non-secret settings", () => {
    writeProjectConfig(projectDir, `team = "PROJ"`);
    const cfg = resolveConfig({ env: baseEnv({ LINEAR_TEAM: "ENVTEAM" }), cwd: projectDir });
    expect(cfg.team).toBe("ENVTEAM");
  });

  it("applies sensible defaults", () => {
    const cfg = resolveConfig({ env: baseEnv() });
    expect(cfg.sort).toBe("priority");
  });

  it("pins every effective-team precedence tier in order", () => {
    type TeamTierCase = {
      name: ConfigSource;
      flag?: string;
      env?: string;
      project?: string;
      profile?: string;
      user?: string;
      global?: string;
    };
    const cases: TeamTierCase[] = [
      {
        name: "flag",
        flag: "FLAG",
        env: "ENV",
        project: "PROJECT",
        profile: "PROFILE",
        user: "USER",
        global: "GLOBAL",
      },
      {
        name: "env",
        env: "ENV",
        project: "PROJECT",
        profile: "PROFILE",
        user: "USER",
        global: "GLOBAL",
      },
      {
        name: "project",
        project: "PROJECT",
        profile: "PROFILE",
        user: "USER",
        global: "GLOBAL",
      },
      { name: "workspace-profile", profile: "PROFILE", user: "USER", global: "GLOBAL" },
      { name: "user", user: "USER", global: "GLOBAL" },
      { name: "global", global: "GLOBAL" },
      { name: "none" },
    ];

    for (const [index, testCase] of cases.entries()) {
      const fixture = join(root, `team-tier-${index}`);
      const cwd = join(fixture, "project");
      const configHome = join(fixture, "xdg");
      mkdirSync(cwd, { recursive: true });
      mkdirSync(join(configHome, "linear"), { recursive: true });
      writeFileSync(
        userConfigPath({ XDG_CONFIG_HOME: configHome, HOME: fixture }),
        `default_workspace = "acme"\n${testCase.user ? `team = "${testCase.user}"\n` : ""}` +
          `[workspaces.acme]\napi_key = "lin_api_acme000000"\n${testCase.profile ? `team = "${testCase.profile}"\n` : ""}`,
      );
      if (testCase.project)
        writeFileSync(join(cwd, ".linear.toml"), `team = "${testCase.project}"\n`);
      if (testCase.global) {
        writeFileSync(join(configHome, "linear", "linear.toml"), `team = "${testCase.global}"\n`);
      }
      const cfg = resolveConfig({
        cwd,
        env: {
          XDG_CONFIG_HOME: configHome,
          HOME: fixture,
          LINEAR_TEAM: testCase.env,
        },
        flags: { team: testCase.flag },
      });
      expect(cfg.team, testCase.name).toBe(
        testCase.flag ??
          testCase.env ??
          testCase.project ??
          testCase.profile ??
          testCase.user ??
          testCase.global,
      );
      expect(cfg.origins.team.source, testCase.name).toBe(testCase.name);
    }
  });

  it("reports workspace-profile provenance with the selected slug", () => {
    writeUserConfig(
      `default_workspace = "acme"\n[workspaces.acme]\napi_key = "lin_api_acme000000"\nteam = "ENG"\n`,
    );
    const cfg = resolveConfig({ env: baseEnv() });
    expect(cfg.team).toBe("ENG");
    expect(cfg.workspaceProfile).toBe("acme");
    expect(cfg.origins.team).toEqual({
      source: "workspace-profile",
      path: userConfigPath(baseEnv()),
      key: "team",
      workspace: "acme",
    });
  });
});

describe("config discovery — every place the reference CLI reads", () => {
  const write = (rel: string, body: string) => {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, body);
    return path;
  };

  it("reads <root>/.config/linear.toml — what schpet's `linear config` writes", () => {
    const path = write("proj/.config/linear.toml", `team_id = "SCH"\nissue_sort = "priority"\n`);
    const cfg = resolveConfig({ env: baseEnv(), cwd: projectDir });
    expect(cfg.team).toBe("SCH");
    expect(cfg.projectConfigPath).toBe(path);
    expect(cfg.origins.team).toEqual({ source: "project", path, key: "team_id" });
    expect(cfg.origins.sort).toEqual({ source: "project", path, key: "issue_sort" });
  });

  it("reads an unhidden linear.toml, walking up from cwd", () => {
    const path = write("proj/linear.toml", `team = "UNHIDDEN"\n`);
    const cfg = resolveConfig({ env: baseEnv(), cwd: projectDir });
    expect(cfg.team).toBe("UNHIDDEN");
    expect(cfg.projectConfigPath).toBe(path);
  });

  it("in one directory, tries linear.toml, then .linear.toml, then .config/linear.toml (schpet's order)", () => {
    write("proj/.config/linear.toml", `team = "DOTCONFIG"\n`);
    write("proj/.linear.toml", `team = "DOTFILE"\n`);
    expect(resolveConfig({ env: baseEnv(), cwd: join(root, "proj") }).team).toBe("DOTFILE");
    write("proj/linear.toml", `team = "PLAIN"\n`);
    expect(resolveConfig({ env: baseEnv(), cwd: join(root, "proj") }).team).toBe("PLAIN");
  });

  it("a nearer directory wins over a farther one regardless of file name", () => {
    write("proj/linear.toml", `team = "FAR"\n`);
    write("proj/nested/.config/linear.toml", `team = "NEAR"\n`);
    expect(resolveConfig({ env: baseEnv(), cwd: projectDir }).team).toBe("NEAR");
  });

  it("reads the reference CLI's global ~/.config/linear/linear.toml, below our config.toml", () => {
    const globalPath = write(
      "xdg/linear/linear.toml",
      `team_id = "GLOBAL"\nissue_sort = "priority"\n`,
    );
    let cfg = resolveConfig({ env: baseEnv(), cwd: root });
    expect(cfg.team).toBe("GLOBAL");
    expect(cfg.globalConfigPath).toBe(globalPath);
    expect(cfg.origins.team).toEqual({ source: "global", path: globalPath, key: "team_id" });
    expect(cfg.origins.sort).toEqual({
      source: "global",
      path: globalPath,
      key: "issue_sort",
    });
    expect(cfg.sortSource).toBe("global");
    // Ours wins on the same key…
    writeUserConfig(`team = "OURS"\n`);
    cfg = resolveConfig({ env: baseEnv(), cwd: root });
    expect(cfg.team).toBe("OURS");
    expect(cfg.origins.team).toEqual({
      source: "user",
      path: userConfigPath(baseEnv()),
      key: "team",
    });
    // …but theirs still fills a key ours does not set.
    expect(cfg.sort).toBe("priority");
    expect(cfg.origins.sort.source).toBe("global");
    // and a project file beats both.
    write("proj/nested/.linear.toml", `team = "PROJ"\n`);
    expect(resolveConfig({ env: baseEnv(), cwd: projectDir }).origins.team.source).toBe("project");
  });

  it("NEVER takes an api_key from the reference CLI's global file (it allows one there)", () => {
    write("xdg/linear/linear.toml", `api_key = "lin_api_globalkey00"\nteam_id = "G"\n`);
    const cfg = resolveConfig({ env: baseEnv(), cwd: root });
    expect(cfg.apiKey).toBeUndefined();
    expect(cfg.apiKeySource).toBe("none");
    expect(cfg.team).toBe("G");
  });

  it("reports globalConfigPath only when the file exists", () => {
    expect(resolveConfig({ env: baseEnv(), cwd: root }).globalConfigPath).toBeUndefined();
  });

  it("origins name the tier for every non-secret setting, `none` for defaults", () => {
    write("proj/nested/.linear.toml", `workspace = "acme"\n`);
    const cfg = resolveConfig({
      env: baseEnv({ LINEAR_ISSUE_SORT: "updated" }),
      cwd: projectDir,
      flags: { team: "FLAG" },
    });
    expect(cfg.origins).toEqual({
      team: { source: "flag", path: undefined },
      workspace: {
        source: "project",
        path: join(projectDir, ".linear.toml"),
        key: "workspace",
      },
      sort: { source: "env", path: undefined },
    });
  });
});

describe("multi-workspace credential resolution", () => {
  function writeWorkspaces(body: string) {
    writeUserConfig(body);
  }

  it("selects credential by --workspace flag", () => {
    writeWorkspaces(
      `default_workspace = "org-a"\n` +
        `[workspaces."org-a"]\napi_key = "lin_api_a000000000"\n` +
        `[workspaces."org-b"]\napi_key = "lin_api_b000000000"\n`,
    );
    const cfg = resolveConfig({ env: baseEnv(), flags: { workspace: "org-b" } });
    expect(cfg.apiKey).toBe("lin_api_b000000000");
    expect(cfg.credentialWorkspace).toBe("org-b");
    expect(cfg.apiKeySource).toBe("user");
  });

  it("selects credential by LINEAR_WORKSPACE env over default", () => {
    writeWorkspaces(
      `default_workspace = "org-a"\n` +
        `[workspaces."org-a"]\napi_key = "lin_api_a000000000"\n` +
        `[workspaces."org-b"]\napi_key = "lin_api_b000000000"\n`,
    );
    const cfg = resolveConfig({ env: baseEnv({ LINEAR_WORKSPACE: "org-b" }) });
    expect(cfg.apiKey).toBe("lin_api_b000000000");
    expect(cfg.credentialWorkspace).toBe("org-b");
  });

  it("falls back to default_workspace when nothing else selects", () => {
    writeWorkspaces(
      `default_workspace = "org-a"\n` +
        `[workspaces."org-a"]\napi_key = "lin_api_a000000000"\n` +
        `[workspaces."org-b"]\napi_key = "lin_api_b000000000"\n`,
    );
    const cfg = resolveConfig({ env: baseEnv() });
    expect(cfg.apiKey).toBe("lin_api_a000000000");
    expect(cfg.credentialWorkspace).toBe("org-a");
  });

  it("uses the only workspace when exactly one exists and no default", () => {
    writeWorkspaces(`[workspaces."solo"]\napi_key = "lin_api_solo000000"\n`);
    const cfg = resolveConfig({ env: baseEnv() });
    expect(cfg.apiKey).toBe("lin_api_solo000000");
    expect(cfg.credentialWorkspace).toBe("solo");
  });

  it("does NOT throw when multiple workspaces exist but none is selected", () => {
    writeWorkspaces(
      `[workspaces."org-a"]\napi_key = "lin_api_a000000000"\n` +
        `[workspaces."org-b"]\napi_key = "lin_api_b000000000"\n`,
    );
    // Resolution is total: no throw, key undefined, deferred error stashed.
    const cfg = resolveConfig({ env: baseEnv() });
    expect(cfg.apiKey).toBeUndefined();
    expect(cfg.apiKeyError?.message).toMatch(/Multiple workspaces/);
    // createClient surfaces the deferred error only when a client is needed.
    expect(() => createClient(cfg)).toThrow(/Multiple workspaces/);
  });

  it("does NOT throw when a selected workspace is not stored (so auth login --workspace new works)", () => {
    writeWorkspaces(`[workspaces."org-a"]\napi_key = "lin_api_a000000000"\n`);
    // flag selection
    const byFlag = resolveConfig({ env: baseEnv(), flags: { workspace: "new-org" } });
    expect(byFlag.apiKey).toBeUndefined();
    expect(byFlag.apiKeyError?.message).toMatch(/No stored credential for workspace 'new-org'/);
    expect(() => createClient(byFlag)).toThrow(/No stored credential/);
    // env selection
    const byEnv = resolveConfig({ env: baseEnv({ LINEAR_WORKSPACE: "ghost" }) });
    expect(byEnv.apiKey).toBeUndefined();
    expect(byEnv.apiKeyError?.message).toMatch(/No stored credential for workspace 'ghost'/);
  });

  it("flag api key bypasses workspace selection entirely", () => {
    writeWorkspaces(
      `default_workspace = "org-a"\n[workspaces."org-a"]\napi_key = "lin_api_a000000000"\n`,
    );
    const cfg = resolveConfig({
      env: baseEnv(),
      flags: { apiKey: "lin_api_flag0000000", workspace: "org-a" },
    });
    expect(cfg.apiKey).toBe("lin_api_flag0000000");
    expect(cfg.apiKeySource).toBe("flag");
    expect(cfg.credentialWorkspace).toBeUndefined();
  });

  it("env api key bypasses workspace selection entirely", () => {
    writeWorkspaces(
      `default_workspace = "org-a"\n[workspaces."org-a"]\napi_key = "lin_api_a000000000"\n`,
    );
    const cfg = resolveConfig({ env: baseEnv({ LINEAR_API_KEY: "lin_api_env00000000" }) });
    expect(cfg.apiKey).toBe("lin_api_env00000000");
    expect(cfg.apiKeySource).toBe("env");
    expect(cfg.credentialWorkspace).toBeUndefined();
  });

  it("selects an already-stored credential from the project workspace", () => {
    writeWorkspaces(
      `default_workspace = "org-a"\n` +
        `[workspaces."org-a"]\napi_key = "lin_api_a000000000"\n` +
        `[workspaces."org-b"]\napi_key = "lin_api_b000000000"\n`,
    );
    writeProjectConfig(projectDir, `workspace = "org-b"`);
    const cfg = resolveConfig({ env: baseEnv(), cwd: projectDir });
    expect(cfg.apiKey).toBe("lin_api_b000000000");
    expect(cfg.credentialWorkspace).toBe("org-b");
    expect(cfg.workspace).toBe("org-b");
  });

  it("reports a project workspace that has no stored credential", () => {
    writeWorkspaces(`[workspaces."org-a"]\napi_key = "lin_api_a000000000"\n`);
    writeProjectConfig(projectDir, `workspace = "missing"`);
    const cfg = resolveConfig({ env: baseEnv(), cwd: projectDir });
    expect(cfg.apiKey).toBeUndefined();
    expect(cfg.apiKeyError?.message).toMatch(/No stored credential for workspace 'missing'/);
  });

  it("--workspace flag still wins the display workspace setting", () => {
    writeWorkspaces(`[workspaces."org-a"]\napi_key = "lin_api_a000000000"\n`);
    writeProjectConfig(projectDir, `workspace = "proj-ws"`);
    const cfg = resolveConfig({ env: baseEnv(), cwd: projectDir, flags: { workspace: "org-a" } });
    expect(cfg.workspace).toBe("org-a");
  });

  it("switches the profile team with the effective credential workspace", () => {
    writeWorkspaces(
      `default_workspace = "org-a"\n` +
        `[workspaces.org-a]\napi_key = "lin_api_a000000000"\nteam = "AAA"\n` +
        `[workspaces.org-b]\napi_key = "lin_api_b000000000"\nteam = "BBB"\n`,
    );
    expect(resolveConfig({ env: baseEnv() })).toMatchObject({
      credentialWorkspace: "org-a",
      workspaceProfile: "org-a",
      team: "AAA",
    });
    expect(resolveConfig({ env: baseEnv(), flags: { workspace: "org-b" } })).toMatchObject({
      credentialWorkspace: "org-b",
      workspaceProfile: "org-b",
      team: "BBB",
    });
  });

  it("lets a project team override its selected workspace profile", () => {
    writeWorkspaces(
      `default_workspace = "org-a"\n[workspaces.org-b]\napi_key = "lin_api_b000000000"\nteam = "BBB"\n`,
    );
    writeProjectConfig(projectDir, `workspace = "org-b"\nteam = "PROJECT"\n`);
    const cfg = resolveConfig({ env: baseEnv(), cwd: projectDir });
    expect(cfg).toMatchObject({ credentialWorkspace: "org-b", team: "PROJECT" });
    expect(cfg.origins.team.source).toBe("project");
  });

  it("keeps the legacy user team when a selected profile has no team", () => {
    writeWorkspaces(
      `default_workspace = "org-a"\nteam = "LEGACY"\n[workspaces.org-a]\napi_key = "lin_api_a000000000"\n`,
    );
    const cfg = resolveConfig({ env: baseEnv() });
    expect(cfg.team).toBe("LEGACY");
    expect(cfg.origins.team.source).toBe("user");
  });

  it("does not bind invocation credentials to an implicit or invalid profile", () => {
    writeWorkspaces(
      `default_workspace = "org-a"\nteam = "LEGACY"\n` +
        `[workspaces.org-a]\napi_key = "lin_api_a000000000"\nteam = "AAA"\n` +
        `[workspaces.org-b]\napi_key = "lin_api_b000000000"\nteam = "BBB"\n`,
    );
    expect(resolveConfig({ env: baseEnv(), flags: { apiKey: "injected" } })).toMatchObject({
      team: "LEGACY",
      workspaceProfile: undefined,
    });
    expect(
      resolveConfig({
        env: baseEnv(),
        cwd: projectDir,
        flags: { accessToken: "injected" },
      }),
    ).toMatchObject({ team: "LEGACY", workspaceProfile: undefined });
    expect(
      resolveConfig({
        env: baseEnv(),
        flags: { apiKey: "injected", workspace: "missing" },
      }),
    ).toMatchObject({ team: "LEGACY", workspaceProfile: undefined });
  });

  it("binds invocation credentials only to an explicitly selected configured profile", () => {
    writeWorkspaces(
      `default_workspace = "org-a"\nteam = "LEGACY"\n` +
        `[workspaces.org-a]\napi_key = "lin_api_a000000000"\nteam = "AAA"\n` +
        `[workspaces.org-b]\napi_key = "lin_api_b000000000"\nteam = "BBB"\n`,
    );
    expect(
      resolveConfig({
        env: baseEnv(),
        flags: { accessToken: "injected", workspace: "org-b" },
      }),
    ).toMatchObject({ team: "BBB", workspaceProfile: "org-b", credentialWorkspace: undefined });
    expect(
      resolveConfig({
        env: baseEnv({ LINEAR_API_KEY: "injected", LINEAR_WORKSPACE: "org-b" }),
      }),
    ).toMatchObject({ team: "BBB", workspaceProfile: "org-b", credentialWorkspace: undefined });
  });
});

function oauthCredential(overrides: Partial<OAuthUserCredential> = {}): OAuthUserCredential {
  return {
    version: 1,
    kind: "oauth-user",
    actor: "user",
    accessToken: "access-old",
    refreshToken: "refresh-old",
    expiresAt: Date.now() + 3_600_000,
    scopes: ["read", "write"],
    tokenType: "Bearer",
    clientId: "client-id",
    workspace: { id: "org-1", name: "Acme", urlKey: "acme" },
    user: { id: "user-1", name: "Ada", email: "ada@example.com" },
    ...overrides,
  };
}

describe("structured credential writers", () => {
  let savedXdg: string | undefined;
  let savedHome: string | undefined;

  beforeEach(() => {
    // The writers read the real process.env, so point it at the temp dir.
    savedXdg = process.env.XDG_CONFIG_HOME;
    savedHome = process.env.HOME;
    process.env.XDG_CONFIG_HOME = xdg;
    process.env.HOME = root;
  });

  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
  });

  function readBack(): Record<string, any> {
    return parseToml(readFileSync(userConfigPath(baseEnv()), "utf8")) as Record<string, any>;
  }

  it("writeCredential upserts and sets default when none exists", () => {
    writeCredential("my-org", "lin_api_first00000", { plaintext: true });
    const obj = readBack();
    expect(obj.default_workspace).toBe("my-org");
    expect(obj.workspaces["my-org"].api_key).toBe("lin_api_first00000");
  });

  it("writeCredential preserves other workspaces and top-level settings", () => {
    writeUserConfig(
      `default_workspace = "org-a"\nteam = "TES"\nsort = "updated"\n` +
        `[workspaces."org-a"]\napi_key = "lin_api_a000000000"\n`,
    );
    writeCredential("org-b", "lin_api_b000000000", { plaintext: true });
    const obj = readBack();
    expect(obj.default_workspace).toBe("org-a"); // unchanged
    expect(obj.team).toBe("TES");
    expect(obj.sort).toBe("updated");
    expect(obj.workspaces["org-a"].api_key).toBe("lin_api_a000000000");
    expect(obj.workspaces["org-b"].api_key).toBe("lin_api_b000000000");
  });

  it("round-trips quoted hyphenated slugs through resolveConfig", () => {
    writeCredential("acme-corp", "lin_api_acme000000", { plaintext: true });
    const cfg = resolveConfig({ env: baseEnv(), flags: { workspace: "acme-corp" } });
    expect(cfg.apiKey).toBe("lin_api_acme000000");
    expect(cfg.credentialWorkspace).toBe("acme-corp");
  });

  it("round-trips slugs needing real quoting (dots)", () => {
    writeCredential("co.uk-org", "lin_api_couk000000", { plaintext: true });
    const cfg = resolveConfig({ env: baseEnv(), flags: { workspace: "co.uk-org" } });
    expect(cfg.apiKey).toBe("lin_api_couk000000");
  });

  it("setDefaultWorkspace updates the default", () => {
    writeCredential("org-a", "lin_api_a000000000", { plaintext: true });
    writeCredential("org-b", "lin_api_b000000000", { plaintext: true });
    setDefaultWorkspace("org-b");
    expect(readBack().default_workspace).toBe("org-b");
  });

  it("setDefaultWorkspace errors for an unconfigured workspace", () => {
    writeCredential("org-a", "lin_api_a000000000", { plaintext: true });
    expect(() => setDefaultWorkspace("ghost")).toThrow(/not configured/);
  });

  it("removeCredential removes only the target workspace", () => {
    writeCredential("org-a", "lin_api_a000000000", { plaintext: true });
    writeCredential("org-b", "lin_api_b000000000", { plaintext: true });
    expect(removeCredential("org-a")).toBe(true);
    const obj = readBack();
    expect(obj.workspaces["org-a"]).toBeUndefined();
    expect(obj.workspaces["org-b"].api_key).toBe("lin_api_b000000000");
  });

  it("removeCredential repoints the default when removing the default", () => {
    writeCredential("org-a", "lin_api_a000000000", { plaintext: true }); // becomes default
    writeCredential("org-b", "lin_api_b000000000", { plaintext: true });
    removeCredential("org-a");
    expect(readBack().default_workspace).toBe("org-b");
  });

  it("removeCredential clears default_workspace when removing the last workspace", () => {
    writeCredential("solo", "lin_api_solo000000", { plaintext: true });
    expect(removeCredential("solo")).toBe(true);
    const obj = readBack();
    expect(obj.default_workspace).toBeUndefined();
    expect(obj.workspaces).toBeUndefined();
  });

  it("removeCredential returns false for an unknown workspace", () => {
    writeCredential("org-a", "lin_api_a000000000", { plaintext: true });
    expect(removeCredential("ghost")).toBe(false);
  });

  it("listCredentials shows one entry per workspace with the default flag", () => {
    writeUserConfig(
      `default_workspace = "org-a"\n` +
        `[workspaces."org-a"]\napi_key = "lin_api_a000000000"\n` +
        `[workspaces."org-b"]\napi_key = "lin_api_b000000000"\n`,
    );
    const list = listCredentials(baseEnv());
    expect(list).toHaveLength(2);
    expect(list.find((e) => e.slug === "org-a")?.isDefault).toBe(true);
    expect(list.find((e) => e.slug === "org-b")?.isDefault).toBe(false);
  });
});

describe("config parse errors never quote the file", () => {
  const SECRET = "lin_api_SUPERSECRETVALUE";

  it("does not echo a truncated api_key line (the secret) into the error", () => {
    // A file that got truncated mid-credential: smol-toml's own message embeds
    // the offending source line, which would print the key to stderr.
    writeUserConfig(`default_workspace = "org"\n[workspaces."org"]\napi_key = "${SECRET}\n`);
    let message = "";
    try {
      resolveConfig({ env: baseEnv() });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/Failed to parse config at/);
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain("api_key");
    // Still actionable: the reason and the position survive.
    expect(message).toMatch(/control characters are not allowed in strings/);
    expect(message).toMatch(/\(line 3, column \d+\)/);
  });

  it("strips control characters a project .linear.toml tries to inject", () => {
    const esc = String.fromCharCode(27);
    // A project file is not trusted: raw ANSI would let it repaint or clear the
    // user's terminal through our error output.
    writeProjectConfig(projectDir, `team = "${esc}[31mPWNED${esc}[2J unterminated\n`);
    let message = "";
    try {
      resolveConfig({ env: baseEnv(), cwd: projectDir });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/Failed to parse config at/);
    expect(message).not.toContain(esc);
    expect(message).not.toContain("PWNED");
    // oxlint-disable-next-line no-control-regex
    expect(message).not.toMatch(new RegExp("[\\u0000-\\u001F\\u007F-\\u009F]"));
  });

  it("caps a pathologically long reason instead of flooding stderr", () => {
    writeUserConfig(`x = ${"9".repeat(5000)}e${"9".repeat(5000)}\n`);
    let message = "";
    try {
      resolveConfig({ env: baseEnv() });
    } catch (err) {
      message = (err as Error).message;
    }
    // path + reason(<=200) + position — nowhere near the 10k source line.
    expect(message.length).toBeLessThan(1000);
  });
});

describe("credential writes are atomic", () => {
  let savedXdg: string | undefined;
  let savedHome: string | undefined;

  beforeEach(() => {
    savedXdg = process.env.XDG_CONFIG_HOME;
    savedHome = process.env.HOME;
    process.env.XDG_CONFIG_HOME = xdg;
    process.env.HOME = root;
  });

  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
  });

  it("a reader holding the old file still sees a COMPLETE config after a write", () => {
    writeCredential("org-a", "lin_api_a000000000", { plaintext: true });
    const path = userConfigPath(baseEnv());
    const before = readFileSync(path, "utf8");

    // A concurrent `linear` process opens the config, then we replace it. An
    // in-place truncate+write would let that reader observe a half-written
    // file; replacing the path by rename cannot.
    const fd = openSync(path, "r");
    try {
      writeCredential("org-b", "lin_api_b000000000", { plaintext: true });
      const seen = readFileSync(fd, "utf8");
      expect(seen).toBe(before);
      expect(parseToml(seen)).toBeTruthy();
    } finally {
      closeSync(fd);
    }

    // ...and the new content did land.
    expect((parseToml(readFileSync(path, "utf8")) as any).workspaces["org-b"].api_key).toBe(
      "lin_api_b000000000",
    );
  });

  it("the replacement is a new file, not a rewrite of the old inode", () => {
    writeCredential("org-a", "lin_api_a000000000", { plaintext: true });
    const path = userConfigPath(baseEnv());
    const first = statSync(path).ino;
    writeCredential("org-b", "lin_api_b000000000", { plaintext: true });
    expect(statSync(path).ino).not.toBe(first);
  });

  it("leaves no temp files behind", () => {
    writeCredential("org-a", "lin_api_a000000000", { plaintext: true });
    writeCredential("org-b", "lin_api_b000000000", { plaintext: true });
    setDefaultWorkspace("org-b");
    removeCredential("org-a");
    expect(readdirSync(join(xdg, "linear"))).toEqual(["config.toml"]);
  });

  it("keeps the credential file at 0600, tightening one that was loosened", () => {
    writeCredential("org-a", "lin_api_a000000000", { plaintext: true });
    const path = userConfigPath(baseEnv());
    expect(statSync(path).mode & 0o777).toBe(0o600);

    chmodSync(path, 0o644);
    writeCredential("org-b", "lin_api_b000000000", { plaintext: true });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("recovers a lock left behind by a dead writer", () => {
    const path = userConfigPath(baseEnv());
    const lockPath = `${path}.lock`;
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: 2_147_483_647, createdAt: Date.now(), token: "dead-writer" }),
    );

    writeCredential("recovered", "lin_api_recovered00", { plaintext: true });

    expect(existsSync(lockPath)).toBe(false);
    expect((parseToml(readFileSync(path, "utf8")) as any).workspaces.recovered.api_key).toBe(
      "lin_api_recovered00",
    );
  });

  it("serializes genuine concurrent credential and user-setting writers", async () => {
    const repo = join(import.meta.dir, "../..");
    const configModule = join(repo, "src", "config.ts");
    const readyDir = join(root, "ready");
    const gate = join(root, "go");
    const writerCount = 12;
    mkdirSync(readyDir);

    const children = Array.from({ length: writerCount }, (_, i) => {
      const action =
        i === 0
          ? `setConfigKey(userConfigPath(), "team", "TES", { mode: 0o600 });`
          : i === 1
            ? `setConfigKey(userConfigPath(), "sort", "updated", { mode: 0o600 });`
            : `writeCredential("org-${i}", "lin_api_org${i.toString().padStart(8, "0")}", { plaintext: true });`;
      const script = `
        import { existsSync, writeFileSync } from "node:fs";
        import { setConfigKey, userConfigPath, writeCredential } from ${JSON.stringify(configModule)};
        const wait = new Int32Array(new SharedArrayBuffer(4));
        writeFileSync(${JSON.stringify(join(readyDir, String(i)))}, "ready");
        while (!existsSync(${JSON.stringify(gate)})) Atomics.wait(wait, 0, 0, 10);
        ${action}
      `;
      return spawn(process.execPath, ["--eval", script], {
        cwd: repo,
        env: { ...process.env, XDG_CONFIG_HOME: xdg, HOME: root },
        stdio: ["ignore", "ignore", "pipe"],
      });
    });

    const finished = children.map(
      (child) =>
        new Promise<{ code: number | null; stderr: string }>((resolve) => {
          let stderr = "";
          child.stderr.on("data", (chunk) => (stderr += String(chunk)));
          child.on("close", (code) => resolve({ code, stderr }));
        }),
    );

    const readyDeadline = performance.now() + 10_000;
    while (readdirSync(readyDir).length < writerCount && performance.now() < readyDeadline) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
    const allReady = readdirSync(readyDir).length === writerCount;
    // Always open the gate so a failed readiness assertion cannot strand children.
    writeFileSync(gate, "go");
    const results = await Promise.all(finished);

    expect(allReady).toBe(true);
    for (const result of results) expect(result).toEqual({ code: 0, stderr: "" });
    const obj = parseToml(readFileSync(userConfigPath(baseEnv()), "utf8")) as any;
    expect(obj.team).toBe("TES");
    expect(obj.sort).toBe("updated");
    expect(Object.keys(obj.workspaces).sort()).toEqual(
      Array.from({ length: writerCount - 2 }, (_, i) => `org-${i + 2}`).sort(),
    );
    expect(statSync(userConfigPath(baseEnv())).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(xdg, "linear"))).toEqual(["config.toml"]);
  });
});

describe("keyring-backed credentials", () => {
  let savedXdg: string | undefined;
  let savedHome: string | undefined;

  beforeEach(() => {
    savedXdg = process.env.XDG_CONFIG_HOME;
    savedHome = process.env.HOME;
    process.env.XDG_CONFIG_HOME = xdg;
    process.env.HOME = root;
  });

  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
  });

  function readBack(): Record<string, any> {
    return parseToml(readFileSync(userConfigPath(baseEnv()), "utf8")) as Record<string, any>;
  }
  /** The reference CLI's credentials.toml, keyring format. */
  function writeReference(body: string) {
    writeFileSync(referenceCredentialsPath(baseEnv()), body);
  }

  describe("resolution", () => {
    it("falls through to the keyring for a `keyring = true` workspace, and says so", () => {
      writeUserConfig(`[workspaces."acme"]\nkeyring = true\n`);
      kr.store.set("acme", "lin_api_fromkeychain");
      const cfg = resolveConfig({ env: baseEnv() });
      expect(cfg.apiKey).toBe("lin_api_fromkeychain");
      expect(cfg.apiKeySource).toBe("keychain");
      expect(cfg.credentialWorkspace).toBe("acme");
    });

    it("finds a schpet/linear-cli user's entry with NO config of ours at all", () => {
      // What a 2.x install leaves behind: the list file + a Keychain item under
      // service linear-cli / account <slug>. Nothing to re-enter.
      writeReference(`default = "lumiere"\nworkspaces = ["lumiere"]\n`);
      kr.store.set("lumiere", "lin_api_schpetkey00");
      const cfg = resolveConfig({ env: baseEnv() });
      expect(cfg.apiKey).toBe("lin_api_schpetkey00");
      expect(cfg.apiKeySource).toBe("keychain");
      expect(cfg.credentialWorkspace).toBe("lumiere");
      expect(cfg.apiKeyError).toBeUndefined();
    });

    it("honors the reference CLI's `default` when it lists several workspaces", () => {
      writeReference(`default = "second"\nworkspaces = ["first", "second"]\n`);
      kr.store.set("first", "lin_api_first000000");
      kr.store.set("second", "lin_api_second00000");
      const cfg = resolveConfig({ env: baseEnv() });
      expect(cfg.credentialWorkspace).toBe("second");
      expect(cfg.apiKey).toBe("lin_api_second00000");
    });

    it("our default_workspace beats the reference CLI's default", () => {
      writeUserConfig(`default_workspace = "ours"\n[workspaces."ours"]\nkeyring = true\n`);
      writeReference(`default = "theirs"\nworkspaces = ["theirs"]\n`);
      kr.store.set("ours", "lin_api_ours0000000");
      kr.store.set("theirs", "lin_api_theirs00000");
      const cfg = resolveConfig({ env: baseEnv() });
      expect(cfg.credentialWorkspace).toBe("ours");
    });

    it("ignores the reference CLI's inline (plaintext) format entirely", () => {
      // Its keys are not one of our secret sources, and listing the slug
      // without the key would only produce a confusing "no stored credential".
      writeReference(`default = "old"\nold = "lin_api_inlineplain0"\n`);
      const cfg = resolveConfig({ env: baseEnv() });
      expect(cfg.apiKey).toBeUndefined();
      expect(cfg.apiKeySource).toBe("none");
      expect(cfg.apiKeyError).toBeUndefined();
      expect(listCredentials(baseEnv())).toEqual([]);
    });

    it("a plaintext api_key in our file beats the keyring for the same slug", () => {
      writeUserConfig(`[workspaces."acme"]\napi_key = "lin_api_fromfile000"\n`);
      kr.store.set("acme", "lin_api_fromkeychain");
      const cfg = resolveConfig({ env: baseEnv() });
      expect(cfg.apiKey).toBe("lin_api_fromfile000");
      expect(cfg.apiKeySource).toBe("user");
    });

    it("probes the keyring for an explicitly selected slug no file lists", () => {
      kr.store.set("orphan", "lin_api_orphan00000");
      const byFlag = resolveConfig({ env: baseEnv(), flags: { workspace: "orphan" } });
      expect(byFlag.apiKey).toBe("lin_api_orphan00000");
      expect(byFlag.apiKeySource).toBe("keychain");
      const byEnv = resolveConfig({ env: baseEnv({ LINEAR_WORKSPACE: "orphan" }) });
      expect(byEnv.apiKey).toBe("lin_api_orphan00000");
    });

    it("a listed slug with nothing in the keyring is a stale entry, reported as such", () => {
      writeUserConfig(`[workspaces."gone"]\nkeyring = true\n`);
      const cfg = resolveConfig({ env: baseEnv() });
      expect(cfg.apiKey).toBeUndefined();
      expect(cfg.apiKeyError?.message).toMatch(/No stored credential for workspace 'gone'/);
    });

    it("a keyring failure is reported as a keyring failure, not as a missing credential", () => {
      writeUserConfig(`[workspaces."acme"]\nkeyring = true\n`);
      const broken: KeyringBackend = {
        ...kr,
        get: () => {
          // What a locked Keychain in an SSH session looks like.
          throw new KeyringError("security find-generic-password failed (exit 36)");
        },
      };
      setKeyringBackend(broken);
      // Resolution stays total (no throw): the failure is stashed like any
      // other selection problem, and it names the store, not "no credential".
      const cfg = resolveConfig({ env: baseEnv() });
      expect(cfg.apiKey).toBeUndefined();
      expect(cfg.apiKeyError?.message).toMatch(
        /Could not read the test keyring entry for workspace 'acme'.*exit 36/,
      );
      expect(cfg.apiKeyError?.message).not.toMatch(/No stored credential/);
      // Anything that is NOT a KeyringError is a bug and must surface.
      setKeyringBackend({
        ...kr,
        get: () => {
          throw new TypeError("oops");
        },
      });
      expect(() => resolveConfig({ env: baseEnv() })).toThrow(/oops/);
    });

    it("with no keyring on the platform, keyring-listed slugs simply have no credential", () => {
      setKeyringBackend(null);
      writeUserConfig(`[workspaces."acme"]\nkeyring = true\n`);
      const cfg = resolveConfig({ env: baseEnv() });
      expect(cfg.apiKey).toBeUndefined();
      expect(cfg.apiKeyError?.message).toMatch(/No stored credential/);
    });

    it("still NEVER reads a key from a project .linear.toml, keyring or not", () => {
      writeProjectConfig(
        projectDir,
        `api_key = "lin_api_projectkey00"\n[workspaces."acme"]\napi_key = "x"\n`,
      );
      const cfg = resolveConfig({ env: baseEnv(), cwd: projectDir });
      expect(cfg.apiKey).toBeUndefined();
    });
  });

  describe("writeCredential", () => {
    it("stores the secret in the keyring by default and only a marker in the file", () => {
      const res = writeCredential("acme", "lin_api_secret00000");
      expect(res.storage).toBe("keychain");
      expect(kr.store.get("acme")).toBe("lin_api_secret00000");
      const obj = readBack();
      expect(obj.workspaces.acme.keyring).toBe(true);
      expect(obj.workspaces.acme.api_key).toBeUndefined();
      expect(readFileSync(userConfigPath(baseEnv()), "utf8")).not.toContain("lin_api_secret");
      expect(obj.default_workspace).toBe("acme");
    });

    it("a re-login moves a plaintext key into the keyring rather than leaving a copy", () => {
      writeUserConfig(
        `[workspaces.acme]\napi_key = "lin_api_old00000000"\nteam = "ENG"\nlabel = "keep"\n`,
      );
      writeCredential("acme", "lin_api_new00000000");
      const obj = readBack();
      expect(obj.workspaces.acme.api_key).toBeUndefined();
      expect(obj.workspaces.acme.keyring).toBe(true);
      expect(obj.workspaces.acme.team).toBe("ENG");
      expect(obj.workspaces.acme.label).toBe("keep");
      expect(kr.store.get("acme")).toBe("lin_api_new00000000");
      expect(resolveConfig({ env: baseEnv() }).apiKey).toBe("lin_api_new00000000");
    });

    it("--plaintext writes the file and drops the keyring marker", () => {
      writeCredential("acme", "lin_api_kc000000000");
      const res = writeCredential("acme", "lin_api_pt000000000", { plaintext: true });
      expect(res.storage).toBe("file");
      const obj = readBack();
      expect(obj.workspaces.acme.api_key).toBe("lin_api_pt000000000");
      expect(obj.workspaces.acme.keyring).toBeUndefined();
    });

    it("falls back to the file, without complaint, where there is no keyring", () => {
      setKeyringBackend(null);
      const res = writeCredential("acme", "lin_api_nokeyring00");
      expect(res.storage).toBe("file");
      expect(res.keyringLabel).toBeUndefined();
      expect(readBack().workspaces.acme.api_key).toBe("lin_api_nokeyring00");
    });

    it("leaves the file untouched when the keyring refuses", () => {
      setKeyringBackend({
        ...kr,
        set: () => {
          throw new Error("keychain locked");
        },
      });
      expect(() => writeCredential("acme", "lin_api_x0000000000")).toThrow(/keychain locked/);
      expect(existsSync(userConfigPath(baseEnv()))).toBe(false);
    });

    it("does not override the reference CLI's default with a new login", () => {
      writeReference(`default = "lumiere"\nworkspaces = ["lumiere"]\n`);
      kr.store.set("lumiere", "lin_api_lumiere0000");
      writeCredential("second", "lin_api_second00000");
      expect(readBack().default_workspace).toBeUndefined();
      expect(resolveConfig({ env: baseEnv() }).credentialWorkspace).toBe("lumiere");
    });
  });

  describe("adoptKeyringCredential", () => {
    it("preserves existing profile team metadata while adopting the keyring marker", () => {
      writeUserConfig(`[workspaces.acme]\nteam = "ENG"\nnote = "keep"\n`);
      kr.store.set("acme", "lin_api_adopt000000");
      adoptKeyringCredential("acme", "lin_api_adopt000000");
      expect(readBack().workspaces.acme).toEqual({
        team: "ENG",
        note: "keep",
        keyring: true,
      });
    });
  });

  describe("listCredentials / setDefaultWorkspace", () => {
    it("lists file, keyring and reference-CLI workspaces with their storage", () => {
      writeUserConfig(
        `default_workspace = "pt"\n[workspaces."pt"]\napi_key = "lin_api_pt000000000"\n[workspaces."kc"]\nkeyring = true\n`,
      );
      writeReference(`workspaces = ["lumiere"]\n`);
      const list = listCredentials(baseEnv());
      expect(list).toEqual([
        { slug: "pt", isDefault: true, storage: "file", credentialType: "api-key" },
        { slug: "kc", isDefault: false, storage: "keychain", credentialType: "api-key" },
        {
          slug: "lumiere",
          isDefault: false,
          storage: "keychain",
          credentialType: "api-key",
        },
      ]);
    });

    it("setDefaultWorkspace accepts a keyring-backed or reference-listed slug", () => {
      writeUserConfig(`[workspaces."kc"]\nkeyring = true\n`);
      writeReference(`workspaces = ["lumiere"]\n`);
      setDefaultWorkspace("kc");
      expect(readBack().default_workspace).toBe("kc");
      setDefaultWorkspace("lumiere");
      expect(readBack().default_workspace).toBe("lumiere");
      expect(() => setDefaultWorkspace("ghost")).toThrow(/not configured/);
    });

    it("sets a profile team atomically while preserving credentials and unrelated metadata", () => {
      writeUserConfig(
        `default_workspace = "acme"\nteam = "LEGACY"\n` +
          `[workspaces.acme]\napi_key = "lin_api_acme000000"\nnote = "keep"\n` +
          `[workspaces.other]\nkeyring = true\nteam = "OTHER"\n`,
      );
      const before = statSync(userConfigPath(baseEnv())).ino;
      expect(setWorkspaceTeam("acme", "ENG", baseEnv())).toBe(userConfigPath(baseEnv()));
      const obj = readBack();
      expect(statSync(userConfigPath(baseEnv())).ino).not.toBe(before);
      expect(obj.default_workspace).toBe("acme");
      expect(obj.team).toBe("LEGACY");
      expect(obj.workspaces.acme).toEqual({
        api_key: "lin_api_acme000000",
        note: "keep",
        team: "ENG",
      });
      expect(obj.workspaces.other).toEqual({ keyring: true, team: "OTHER" });
    });

    it("adds metadata to a reference-listed profile without rewriting its credential list", () => {
      writeReference(`default = "lumiere"\nworkspaces = ["lumiere"]\n`);
      const before = readFileSync(referenceCredentialsPath(baseEnv()), "utf8");
      setWorkspaceTeam("lumiere", "LUMI", baseEnv());
      expect(readBack().workspaces.lumiere).toEqual({ team: "LUMI" });
      expect(readFileSync(referenceCredentialsPath(baseEnv()), "utf8")).toBe(before);
    });

    it("refuses to create team metadata for an unknown profile", () => {
      expect(() => setWorkspaceTeam("ghost", "ENG", baseEnv())).toThrow(/not configured/);
      expect(existsSync(userConfigPath(baseEnv()))).toBe(false);
    });
  });

  describe("OAuth keyring credentials", () => {
    it("stores the entire session only in the keyring and resolves it as an access token", () => {
      writeUserConfig(`[workspaces.acme]\nkeyring = true\nteam = "ENG"\nnote = "keep"\n`);
      const credential = oauthCredential();
      writeOAuthCredential(credential);
      const file = readFileSync(userConfigPath(), "utf8");
      expect(file).toContain("oauth = true");
      expect(file).not.toContain("access-old");
      expect(file).not.toContain("refresh-old");
      expect(kr.store.get("oauth:acme")).toContain("refresh-old");
      expect(readBack().workspaces.acme).toMatchObject({
        keyring: true,
        oauth: true,
        team: "ENG",
        note: "keep",
      });
      expect(readOAuthCredential("acme")).toEqual(credential);
      const resolved = resolveConfig({ env: baseEnv() });
      expect(resolved).toMatchObject({
        accessToken: "access-old",
        accessTokenSource: "keychain",
        credentialWorkspace: "acme",
      });
      expect(resolved.oauthCredential?.workspace.id).toBe("org-1");
    });

    it("refuses OAuth persistence without a system keyring", () => {
      setKeyringBackend(null);
      expect(() => writeOAuthCredential(oauthCredential())).toThrow(/keyring/);
      expect(existsSync(userConfigPath())).toBe(false);
    });

    it("atomically keeps a concurrent rotation winner", () => {
      writeOAuthCredential(oauthCredential());
      const winner = oauthCredential({
        accessToken: "access-winner",
        refreshToken: "refresh-winner",
      });
      expect(rotateOAuthCredential("acme", "refresh-old", winner)).toEqual(winner);
      const stale = oauthCredential({ accessToken: "access-stale", refreshToken: "refresh-stale" });
      expect(rotateOAuthCredential("acme", "refresh-old", stale)).toEqual(winner);
      expect(readOAuthCredential("acme")?.refreshToken).toBe("refresh-winner");
    });

    it("preserves and restores an existing keyring API-key profile", () => {
      writeCredential("acme", "lin_api_existing0000");
      setWorkspaceTeam("acme", "ENG", baseEnv());
      writeOAuthCredential(oauthCredential());
      expect(resolveConfig({ env: baseEnv() }).oauthCredential).toBeDefined();

      expect(removeOAuthCredential("acme")).toEqual({
        removed: true,
        fallbackCredentialType: "api-key",
        teamMetadataRemoved: false,
      });
      expect(kr.store.has("oauth:acme")).toBe(false);
      expect(kr.store.get("acme")).toBe("lin_api_existing0000");
      expect(readBack().workspaces.acme).toEqual({ keyring: true, team: "ENG" });
      expect(resolveConfig({ env: baseEnv() }).apiKey).toBe("lin_api_existing0000");
    });

    it("does not overwrite a pre-existing plaintext API-key profile", () => {
      writeCredential("acme", "lin_api_plain000000", { plaintext: true });
      writeOAuthCredential(oauthCredential());
      expect(readBack().workspaces.acme).toMatchObject({
        api_key: "lin_api_plain000000",
        oauth: true,
      });

      expect(removeOAuthCredential("acme").fallbackCredentialType).toBe("api-key");
      expect(readBack().workspaces.acme).toEqual({ api_key: "lin_api_plain000000" });
    });

    it("reports team metadata removal when OAuth logout removes the whole profile", () => {
      writeOAuthCredential(oauthCredential());
      setWorkspaceTeam("acme", "ENG", baseEnv());
      expect(removeOAuthCredential("acme")).toEqual({
        removed: true,
        fallbackCredentialType: null,
        teamMetadataRemoved: true,
      });
      expect(readBack().workspaces).toBeUndefined();
    });
  });

  describe("removeCredential", () => {
    it("removes the keyring entry along with the table", () => {
      writeCredential("acme", "lin_api_secret00000");
      expect(removeCredential("acme")).toBe(true);
      expect(kr.store.has("acme")).toBe(false);
      expect(readBack().workspaces).toBeUndefined();
    });

    it("forgets a reference-CLI workspace: keyring entry gone, its list rewritten in its own layout", () => {
      writeReference(`default = "lumiere"\nworkspaces = ["lumiere", "other"]\n`);
      kr.store.set("lumiere", "lin_api_lumiere0000");
      expect(removeCredential("lumiere")).toBe(true);
      expect(kr.store.has("lumiere")).toBe(false);
      const ref = parseToml(readFileSync(referenceCredentialsPath(baseEnv()), "utf8")) as any;
      expect(ref).toEqual({ default: "other", workspaces: ["other"] });
      expect(listCredentials(baseEnv()).map((e) => e.slug)).toEqual(["other"]);
    });

    it("returns false when nothing anywhere knows the slug", () => {
      writeCredential("acme", "lin_api_secret00000");
      expect(removeCredential("ghost")).toBe(false);
    });

    it("reports whether removing the profile also removed team metadata", () => {
      writeCredential("acme", "lin_api_secret00000");
      setWorkspaceTeam("acme", "ENG", baseEnv());
      expect(removeCredentialWithMetadata("acme")).toEqual({
        removed: true,
        teamMetadataRemoved: true,
      });
      expect(removeCredentialWithMetadata("ghost")).toEqual({
        removed: false,
        teamMetadataRemoved: false,
      });
    });
  });

  describe("migrateCredentials", () => {
    it("moves every plaintext key into the keyring and leaves markers", () => {
      writeUserConfig(
        `default_workspace = "a"\nteam = "TES"\n` +
          `[workspaces."a"]\napi_key = "lin_api_a000000000"\nteam = "AAA"\n` +
          `[workspaces."b"]\napi_key = "lin_api_b000000000"\nteam = "BBB"\n` +
          `[workspaces."c"]\nkeyring = true\n`,
      );
      const res = migrateCredentials();
      expect(res.migrated.sort()).toEqual(["a", "b"]);
      expect(kr.store.get("a")).toBe("lin_api_a000000000");
      expect(kr.store.get("b")).toBe("lin_api_b000000000");
      const text = readFileSync(userConfigPath(baseEnv()), "utf8");
      expect(text).not.toContain("lin_api_");
      const obj = readBack();
      expect(obj.workspaces.a).toEqual({ keyring: true, team: "AAA" });
      expect(obj.workspaces.b).toEqual({ keyring: true, team: "BBB" });
      expect(obj.team).toBe("TES");
      expect(obj.default_workspace).toBe("a");
      expect(resolveConfig({ env: baseEnv() })).toMatchObject({
        apiKey: "lin_api_a000000000",
        apiKeySource: "keychain",
      });
    });

    it("is a no-op with nothing to migrate", () => {
      writeUserConfig(`[workspaces."c"]\nkeyring = true\n`);
      const before = readFileSync(userConfigPath(baseEnv()), "utf8");
      expect(migrateCredentials().migrated).toEqual([]);
      expect(readFileSync(userConfigPath(baseEnv()), "utf8")).toBe(before);
    });

    it("rolls back the keyring and leaves the file alone if one store fails", () => {
      writeUserConfig(
        `[workspaces."a"]\napi_key = "lin_api_a000000000"\n` +
          `[workspaces."b"]\napi_key = "lin_api_b000000000"\n`,
      );
      const before = readFileSync(userConfigPath(baseEnv()), "utf8");
      let calls = 0;
      setKeyringBackend({
        ...kr,
        set: (a, s) => {
          if (++calls === 2) throw new Error("disk full");
          kr.store.set(a, s);
        },
      });
      expect(() => migrateCredentials()).toThrow(/disk full.*Rolled back 1/);
      expect(kr.store.size).toBe(0);
      expect(readFileSync(userConfigPath(baseEnv()), "utf8")).toBe(before);
    });

    it("refuses where there is no keyring, naming the file that keeps the keys", () => {
      setKeyringBackend(null);
      writeUserConfig(`[workspaces."a"]\napi_key = "lin_api_a000000000"\n`);
      expect(() => migrateCredentials()).toThrow(/No system keyring/);
    });
  });
});

describe("redactKey", () => {
  it("keeps the lin_api_ prefix and last 4", () => {
    expect(redactKey("lin_api_ABCDEFGHIJKLMNOP")).toBe("lin_api_••••MNOP");
  });
  it("handles missing key", () => {
    expect(redactKey(undefined)).toBe("(not set)");
  });
  it("fully masks short keys", () => {
    expect(redactKey("short")).toBe("••••");
  });
});

describe("project config writers (`config init` / `config set`)", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("initProjectConfig writes a commented .linear.toml with the given settings, and refuses to clobber", () => {
    const path = join(root, "proj", ".linear.toml");
    initProjectConfig(path, { team: "TES", sort: "updated" });
    const text = read(path);
    expect(text).toMatch(/^# linear-sdk-cli project config/);
    expect(text).toContain("The API key never goes here");
    expect(parseToml(text)).toEqual({ team: "TES", sort: "updated" });
    expect(resolveConfig({ env: baseEnv(), cwd: projectDir }).team).toBe("TES");
    expect(() => initProjectConfig(path, { team: "ENG" })).toThrow(/already exists.*config set/);
    initProjectConfig(path, { team: "ENG" }, { force: true });
    expect(parseToml(read(path))).toEqual({ team: "ENG" });
  });

  it("setConfigKey creates the file when there is none", () => {
    const path = join(root, "proj", ".linear.toml");
    expect(setConfigKey(path, "team", "TES")).toBe("team");
    expect(parseToml(read(path))).toEqual({ team: "TES" });
    expect(statSync(path).mode & 0o777).toBe(0o644);
  });

  it("setConfigKey replaces a key's line in place and keeps comments and layout", () => {
    const path = join(root, "proj", ".linear.toml");
    writeFileSync(
      path,
      `# our team\nteam = "TES" # trailing note\n\n# sorting\nsort = "priority"\n\n[extra]\nteam = "NOT-TOP-LEVEL"\n`,
    );
    setConfigKey(path, "team", "ENG");
    expect(read(path)).toBe(
      `# our team\nteam = "ENG" # trailing note\n\n# sorting\nsort = "priority"\n\n[extra]\nteam = "NOT-TOP-LEVEL"\n`,
    );
  });

  it("setConfigKey appends a missing key before the first table, after existing top-level keys", () => {
    const path = join(root, "proj", ".linear.toml");
    writeFileSync(path, `team = "TES"\n\n[extra]\nx = 1\n`);
    setConfigKey(path, "sort", "updated");
    expect(read(path)).toBe(`team = "TES"\nsort = "updated"\n\n[extra]\nx = 1\n`);
    // and a file that opens with a table gets a blank line between
    writeFileSync(path, `[extra]\nx = 1\n`);
    setConfigKey(path, "team", "TES");
    expect(read(path)).toBe(`team = "TES"\n\n[extra]\nx = 1\n`);
  });

  it("setConfigKey keeps the reference CLI's spelling when the file already uses it", () => {
    // A schpet-written .config/linear.toml.
    const path = join(root, "proj", ".config", "linear.toml");
    mkdirSync(join(root, "proj", ".config"), { recursive: true });
    writeFileSync(
      path,
      `# linear cli\nworkspace = "acme"\nteam_id = "TES"\nissue_sort = "priority"\n`,
    );
    expect(setConfigKey(path, "team", "ENG")).toBe("team_id");
    expect(setConfigKey(path, "sort", "updated")).toBe("issue_sort");
    expect(read(path)).toBe(
      `# linear cli\nworkspace = "acme"\nteam_id = "ENG"\nissue_sort = "updated"\n`,
    );
    // Nothing competes: one key, one spelling, and the reader agrees.
    expect(resolveConfig({ env: baseEnv(), cwd: projectDir })).toMatchObject({
      team: "ENG",
      sort: "updated",
    });
  });

  it("setConfigKey never touches a same-named key inside a table (the user config's api_key)", () => {
    const path = userConfigPath(baseEnv());
    writeFileSync(
      path,
      `default_workspace = "acme"\n\n[workspaces.acme]\napi_key = "lin_api_secret00000"\n`,
    );
    setConfigKey(path, "team", "TES", { mode: 0o600 });
    const text = read(path);
    expect(text).toBe(
      `default_workspace = "acme"\nteam = "TES"\n\n[workspaces.acme]\napi_key = "lin_api_secret00000"\n`,
    );
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(resolveConfig({ env: baseEnv(), cwd: root })).toMatchObject({
      team: "TES",
      apiKey: "lin_api_secret00000",
    });
  });

  it("setConfigKey refuses to edit a file it cannot parse, and names it", () => {
    const path = join(root, "proj", ".linear.toml");
    writeFileSync(path, `team = "unterminated\n`);
    expect(() => setConfigKey(path, "team", "TES")).toThrow(/Failed to parse config at/);
    expect(read(path)).toBe(`team = "unterminated\n`);
  });

  it("setConfigKey writes atomically (a new inode, no temp files left)", () => {
    const path = join(root, "proj", ".linear.toml");
    setConfigKey(path, "team", "TES");
    const first = statSync(path).ino;
    setConfigKey(path, "team", "ENG");
    expect(statSync(path).ino).not.toBe(first);
    expect(readdirSync(join(root, "proj")).sort()).toEqual([".linear.toml", "nested"]);
  });

  it("assertSettableKey refuses secrets and unknown keys with a pointed message", () => {
    for (const k of ["api_key", "workspaces", "default_workspace", "keyring"]) {
      expect(() => assertSettableKey(k)).toThrow(/not a project setting.*auth login/);
    }
    expect(() => assertSettableKey("colour")).toThrow(
      /Unknown setting 'colour'.*team, workspace, sort/,
    );
    for (const k of SETTABLE_KEYS) expect(() => assertSettableKey(k)).not.toThrow();
  });

  it("defaultProjectConfigPath is <git root>/.linear.toml inside a repo, <cwd>/.linear.toml outside", () => {
    expect(defaultProjectConfigPath(projectDir)).toBe(join(projectDir, ".linear.toml"));
    execFileSync("git", ["init", "-q"], { cwd: join(root, "proj") });
    expect(defaultProjectConfigPath(projectDir)).toBe(
      join(realpathSync(root), "proj", ".linear.toml"),
    );
  });
});
